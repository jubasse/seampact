"""The boot check of an api (ADR 0027 "The system check and the boot check"): every problem at once, each naming the
operation or setting and the fix. The boundary's `__init__` raises on any, the system check reports each as a
warning, and `manage.py seampact_check` exits non-zero."""

import inspect
import re
from collections.abc import Iterator, Sequence
from importlib import import_module
from typing import TYPE_CHECKING, ClassVar, Final, Protocol

from django.conf import settings
from django.urls import LocalePrefixPattern, URLPattern, URLResolver, get_resolver
from django.urls.exceptions import Resolver404

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.framework_routes import FrameworkRouteRule, allow_listed, base_path_of
from seampact.codegen.runtime.framework_versions import AcceptedFramework, framework_version_problems
from seampact.codegen.runtime.hook_check import hook_needs
from seampact.codegen.runtime.ir_view import ir_int, ir_map, ir_string
from seampact.codegen.runtime.version import other_version_problem
from seampact.django.runtime.api_settings import (
    AUTHENTICATE_KEY,
    DECIDERS_KEY,
    HANDLERS_KEY,
    HOOK_KEYS,
    ON_UNEXPECTED_ERROR_KEY,
    SCOPE_RESOLVERS_KEY,
    SETTINGS_NAME,
    SettingsError,
    api_settings,
    dotted_paths,
    factory,
)
from seampact.django.runtime.error_handlers import unwrapped_error_handlers

if TYPE_CHECKING:
    from django.urls.resolvers import ResolverMatch

_SAMPLE_SEGMENT: Final = "seampact-sample"
_PLACEHOLDER_START: Final = "{"
_PUBLIC_ORIGIN_KEY: Final = "public_origin"
_ABSOLUTE_URLS: Final = "absolute"
_HTTP_ORIGIN_PREFIXES: Final = ("http://", "https://")
# A Django pattern answers every method; an allow-list item names it with no method.
_ANY_METHOD: Final = ""
_ROUTE_CONVERTER: Final = re.compile(r"<[^<>]*>")
_HOOK_METHODS: Final = {AUTHENTICATE_KEY: "authenticate", DECIDERS_KEY: "decide", SCOPE_RESOLVERS_KEY: "resolve_scope"}


class BoundaryDeclaration(Protocol):
    """What the check reads of a generated boundary class."""

    api: ClassVar[str]
    generated_by: ClassVar[str]
    contract: ClassVar[ApiContract]
    settings_keys: ClassVar[Sequence[str]]
    handler_resources: ClassVar[Sequence[str]]
    frameworks: ClassVar[Sequence[AcceptedFramework]]
    framework_routes: ClassVar[Sequence[FrameworkRouteRule]]
    body_validation: ClassVar[bool]
    boot_check_hooks: ClassVar[bool]
    boot_check_framework_routes: ClassVar[bool]


def operation_route_name(contract: ApiContract, operation_id: str) -> str:
    """The name of the URL pattern serving an operation: the name of its path's first operation."""
    path = ir_string(contract.operation(operation_id), "path")
    first = next(
        (other for other in contract.operation_ids() if ir_string(contract.operation(other), "path") == path),
        operation_id,
    )

    return contract.route_name(first)


def boot_problems(boundary: type[BoundaryDeclaration]) -> list[str]:
    """Every problem of the api; the version guard (G3) comes first and alone, since nothing else can be trusted."""
    version = other_version_problem(boundary.api, boundary.generated_by)

    if version is not None:
        return [version]

    problems = [
        *framework_version_problems(boundary.frameworks, boundary.api),
        *_settings_problems(boundary),
        *_include_problems(boundary),
        *_route_problems(boundary),
        *_deployment_problems(boundary),
    ]

    if boundary.boot_check_framework_routes:
        problems += _framework_route_problems(boundary)

    if boundary.boot_check_hooks:
        problems += _hook_problems(boundary)

    return problems


def middleware_boundaries() -> list[type[BoundaryDeclaration]]:
    """The seampact boundaries listed in `MIDDLEWARE`, in order."""
    from seampact.django.runtime.boundary import ContractBoundary

    return [entry for entry in _middleware_classes() if isinstance(entry, type) and issubclass(entry, ContractBoundary)]


def every_problem() -> list[tuple[str, str]]:
    """The problems of every api the app serves, by api: those of each boundary in `MIDDLEWARE`, and the apis whose
    patterns are in the URLconf without their boundary."""
    boundaries = middleware_boundaries()
    found = [(boundary.api, problem) for boundary in boundaries for problem in boot_problems(boundary)]
    served = {boundary.api for boundary in boundaries}

    for api in sorted({contract.api for contract in _contracts_in_urlconf()} - served):
        found.append(
            (
                api,
                f"the URLconf includes the patterns of api '{api}' without its boundary in MIDDLEWARE; list "
                f"its generated <Api>Boundary first in MIDDLEWARE.",
            )
        )

    return found


def _settings_problems(boundary: type[BoundaryDeclaration]) -> list[str]:
    try:
        own = api_settings(boundary.api)
    except SettingsError as broken:
        return [str(broken)]

    problems = [
        f"settings.{SETTINGS_NAME}['{boundary.api}'] has the unknown key '{key}'; the keys are "
        f"{', '.join(boundary.settings_keys)}."
        for key in own
        if key not in boundary.settings_keys
    ]
    problems += _factory_problems(boundary.api, HANDLERS_KEY, boundary.handler_resources)

    if boundary.body_validation:
        problems.append(
            f"the api '{boundary.api}' sets bodyValidation, which this release of seampact-django does not serve "
            "yet; remove the option until a release serves it."
        )

    listener = own.get(ON_UNEXPECTED_ERROR_KEY)

    if isinstance(listener, str):
        problems += _imported_problems(boundary.api, f"['{ON_UNEXPECTED_ERROR_KEY}']", listener, "on_unexpected_error")

    return problems


def _hook_problems(boundary: type[BoundaryDeclaration]) -> list[str]:
    contract = boundary.contract
    needs = hook_needs(contract)
    authenticated = [
        identity
        for identity in needs.identities
        if ir_string(contract.declaration("identities", identity), "signed") is None
    ]
    needed = {AUTHENTICATE_KEY: authenticated, DECIDERS_KEY: needs.deciders, SCOPE_RESOLVERS_KEY: needs.scopes}
    problems: list[str] = []

    for key in HOOK_KEYS:
        problems += _factory_problems(boundary.api, key, sorted(needed[key]))

    return problems


def _factory_problems(api: str, key: str, names: Sequence[str]) -> list[str]:
    try:
        paths = dotted_paths(api, key)
    except SettingsError as broken:
        return [str(broken)]

    problems = [
        f"settings.{SETTINGS_NAME}['{api}']['{key}'] has no entry for '{name}'; add the dotted path of its factory."
        for name in names
        if name not in paths
    ]
    problems += [
        f"settings.{SETTINGS_NAME}['{api}']['{key}'] names '{name}', which the contract does not use; remove it."
        for name in paths
        if name not in names
    ]

    for name, path in paths.items():
        problems += _imported_problems(api, f"['{key}']['{name}']", path, _HOOK_METHODS.get(key))

    return problems


def _imported_problems(api: str, setting: str, path: str, hook_method: str | None = None) -> list[str]:
    """A factory that does not import, an `async def` factory, or a built class with an `async def` method the sync
    views would call: the hook's method, or any public method of a handler class."""
    try:
        built_by = factory(api, setting, path)
    except SettingsError as broken:
        return [str(broken)]

    if inspect.iscoroutinefunction(built_by):
        return [
            f"settings.{SETTINGS_NAME}['{api}']{setting} names the async def '{path}'; DRF views are sync, so write "
            "the factory as a plain def."
        ]

    return [
        f"settings.{SETTINGS_NAME}['{api}']{setting} builds a {built_class.__qualname__} whose method '{method}' is "
        "an async def; DRF views are sync, so write it as a plain def."
        for built_class in _built_classes(built_by)
        for method in _async_methods(built_class, hook_method)
    ]


def _built_classes(built_by: object) -> list[type]:
    """The class a factory builds: the factory itself when it is a class, else its declared return type."""
    if isinstance(built_by, type):
        return [built_by]

    try:
        returned = inspect.signature(built_by).return_annotation if callable(built_by) else None
    except (TypeError, ValueError):
        return []

    return [returned] if isinstance(returned, type) else []


def _async_methods(built_class: type, hook_method: str | None) -> list[str]:
    names = (
        [hook_method] if hook_method is not None else [name for name in dir(built_class) if not name.startswith("_")]
    )

    return [name for name in names if inspect.iscoroutinefunction(getattr(built_class, name, None))]


def _route_problems(boundary: type[BoundaryDeclaration]) -> list[str]:
    """Each operation's sample request must resolve to its own generated view, served by one pattern only."""
    contract = boundary.contract
    problems: list[str] = []
    names = [pattern.name for pattern in _patterns(get_resolver().url_patterns)]

    for operation_id in contract.operation_ids():
        route_name = operation_route_name(contract, operation_id)
        sample = _sample_path(contract, operation_id)

        if names.count(route_name) > 1:
            problems.append(
                f"operation '{operation_id}': its path pattern '{route_name}' is included twice; include "
                "the api's urls once."
            )

        problems += _resolved_problems(boundary, operation_id, route_name, sample)

    return problems


def _resolved_problems(
    boundary: type[BoundaryDeclaration], operation_id: str, route_name: str, sample: str
) -> list[str]:
    contract = boundary.contract

    try:
        resolved: ResolverMatch = get_resolver().resolve(sample)
    except Resolver404:
        return [
            f"operation '{operation_id}': no URL pattern serves {sample}; include the api's urls module at \"\" "
            "in the root URLconf, without a prefix."
        ]

    view_class = getattr(resolved.func, "view_class", None)

    if getattr(view_class, "contract", None) is contract and resolved.url_name == route_name:
        return []

    if allow_listed(boundary.framework_routes, _route_text(resolved.route), _ANY_METHOD):
        return []

    return [
        f"operation '{operation_id}': {sample} reaches '{resolved.view_name}', not its generated view; move "
        "that pattern after the api's urls, or out of the api's base paths, or allow-list it in the entry's "
        "frameworkRoutes with a reason."
    ]


def _include_problems(boundary: type[BoundaryDeclaration]) -> list[str]:
    """The api's generated patterns under `i18n_patterns()`, or under an `include()` with a prefix: both route
    requests the contract does not name, such as `/fr/v1/tasks/7`."""
    problems: list[str] = []

    for resolver in _resolvers(get_resolver().url_patterns):
        if not any(_contract_of(pattern) is boundary.contract for pattern in _patterns(resolver.url_patterns)):
            continue

        if isinstance(resolver.pattern, LocalePrefixPattern):
            problems.append(
                f"the patterns of api '{boundary.api}' sit under i18n_patterns(), which serves them under a language "
                "prefix too; include the api's urls outside i18n_patterns()."
            )
        elif str(resolver.pattern):
            problems.append(
                f"the patterns of api '{boundary.api}' are included under the prefix '{resolver.pattern}'; include "
                "the api's urls at \"\" and set the entry's mount instead."
            )

    return problems


def _framework_route_problems(boundary: type[BoundaryDeclaration]) -> list[str]:
    """An app pattern at or under one of the api's base paths that `frameworkRoutes` does not allow-list (FR-25),
    read from the patterns' own prefixes."""
    problems: list[str] = []

    for prefixes, pattern in _prefixed_patterns(get_resolver().url_patterns, ()):
        if _contract_of(pattern) is not None:
            continue

        text = _route_text("".join([*prefixes, str(pattern.pattern)]))
        base = base_path_of(text, boundary.contract.base_paths())

        if base is None or allow_listed(boundary.framework_routes, text, _ANY_METHOD):
            continue

        problems.append(
            f"the app pattern '{text}' sits under the api's base path '{base}' and is not a contract route; remove "
            "it, or allow-list it in the entry's frameworkRoutes with a reason and no method."
        )

    return problems


def _route_text(route: str) -> str:
    """A Django route as a contract path reads: a leading `/`, regex anchors dropped, each converter as `{}`."""
    return "/" + _ROUTE_CONVERTER.sub("{}", route.replace("^", "").replace("$", ""))


def _deployment_problems(boundary: type[BoundaryDeclaration]) -> list[str]:
    contract = boundary.contract
    problems: list[str] = []
    before = _middleware_classes()
    position = before.index(boundary) if boundary in before else -1
    from seampact.django.runtime.boundary import ContractBoundary

    outside = [
        entry
        for entry in before[: max(position, 0)]
        if not (isinstance(entry, type) and issubclass(entry, ContractBoundary))
    ]

    if position < 0 or outside:
        problems.append(
            f"the boundary of api '{boundary.api}' is not first in MIDDLEWARE; list it first, other "
            "seampact boundaries aside."
        )

    largest = max(
        (ir_int(ir_map(contract.operation(op), "input"), "bodyLimitBytes") or 0 for op in contract.operation_ids()),
        default=0,
    )
    upload_limit = settings.DATA_UPLOAD_MAX_MEMORY_SIZE

    if upload_limit is not None and upload_limit < largest:
        problems.append(
            f"DATA_UPLOAD_MAX_MEMORY_SIZE ({upload_limit}) is below the api's largest body limit "
            f"({largest}); raise it to at least {largest}, or set it to None."
        )

    problems += [
        f"the root URLconf's {name} carries no seampact wrapper; set it in the root URLconf before the boundary loads."
        for name in unwrapped_error_handlers()
    ]
    problems += _public_origin_problems(boundary.api, contract)

    return problems


def _public_origin_problems(api: str, contract: ApiContract) -> list[str]:
    origin = api_settings(api).get(_PUBLIC_ORIGIN_KEY)
    absolute = ir_string(ir_map(ir_map(contract.ir_view, "api"), "wire"), "urls") == _ABSOLUTE_URLS
    setting = f"settings.{SETTINGS_NAME}['{api}']['{_PUBLIC_ORIGIN_KEY}']"

    if not absolute and origin is not None:
        return [f"{setting} is set while the api writes relative URLs; remove it."]

    if absolute and not (isinstance(origin, str) and origin.startswith(_HTTP_ORIGIN_PREFIXES)):
        return [f"{setting} must be the api's public origin, such as 'https://api.example.com', under absolute URLs."]

    return []


def _sample_path(contract: ApiContract, operation_id: str) -> str:
    path = contract.mount + (ir_string(contract.operation(operation_id), "path") or "")

    return "/".join(_SAMPLE_SEGMENT if part.startswith(_PLACEHOLDER_START) else part for part in path.split("/"))


def _patterns(entries: Sequence[URLPattern | URLResolver]) -> Iterator[URLPattern]:
    for entry in entries:
        if isinstance(entry, URLResolver):
            yield from _patterns(entry.url_patterns)
        else:
            yield entry


def _resolvers(entries: Sequence[URLPattern | URLResolver]) -> Iterator[URLResolver]:
    for entry in entries:
        if isinstance(entry, URLResolver):
            yield entry
            yield from _resolvers(entry.url_patterns)


def _prefixed_patterns(
    entries: Sequence[URLPattern | URLResolver], prefixes: tuple[str, ...]
) -> Iterator[tuple[tuple[str, ...], URLPattern]]:
    for entry in entries:
        if isinstance(entry, URLResolver):
            yield from _prefixed_patterns(entry.url_patterns, (*prefixes, str(entry.pattern)))
        else:
            yield prefixes, entry


def _contract_of(pattern: URLPattern) -> ApiContract | None:
    contract = getattr(getattr(pattern.callback, "view_class", None), "contract", None)

    return contract if isinstance(contract, ApiContract) else None


def _contracts_in_urlconf() -> list[ApiContract]:
    contracts: list[ApiContract] = []

    for pattern in _patterns(get_resolver().url_patterns):
        contract = _contract_of(pattern)

        if contract is not None and all(known is not contract for known in contracts):
            contracts.append(contract)

    return contracts


def _middleware_classes() -> list[object]:
    classes: list[object] = []

    for path in settings.MIDDLEWARE:
        module_path, _, name = str(path).rpartition(".")

        try:
            classes.append(getattr(import_module(module_path), name))
        except (ImportError, AttributeError):
            classes.append(path)

    return classes
