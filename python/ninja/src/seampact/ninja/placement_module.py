"""The `ninja` module of an api's package (ADR 0027 "Ninja"): `GENERATED_BY`, the api's placement (each contract
operation's route below the router's prefix, `GET` with `HEAD`, under the URL name of its path; its contract exception
base; how its views run; its credentials types), the `<Api>HandlerFactories` the app fills, one function per
operation calling its handler method, one view per operation taking the request and one `str` per path placeholder,
and `bind_<api>()`, which hands each operation to the runtime with its view. The views are plain functions under
`views: sync` and `async def` under `views: async`."""

from collections.abc import Mapping, Sequence
from typing import Final

from seampact.codegen.placement_lines import (
    add_operation_call,
    credentials_types,
    operation_types_arguments,
    tuple_literal,
    unexpected_error_listener,
)
from seampact.codegen.printer import INDENT, PythonModule, bracketed, string_literal
from seampact.codegen.pydantic_layout import ApiLayout
from seampact.codegen.routes import RouteEntry
from seampact.codegen.runtime import RUNTIME_VERSION
from seampact.codegen.source_lines import with_local_imports
from seampact.django.emitters.urls_module import PATH_ARGUMENT_PREFIX
from seampact.ir.model import ContractIR
from seampact.ninja.views_mode import ViewsMode

_RUNTIME: Final = "_runtime"
_HOOKS: Final = "_hooks"
_ABC: Final = "_abc"
_HTTP: Final = "_http"
_NINJA: Final = "_ninja"
# Each operation's handler call and view: no module alias starts so, whatever the operation's name.
_CALL_PREFIX: Final = "_call_"
_VIEW_PREFIX: Final = "_view_"
_CONTRACT_MODULE: Final = "contract"
_SCHEMAS_MODULE: Final = "schemas"
_BIND_DOC: Final = (
    "Adds the api's Router to `api`; the URLconf prefix of `api.urls` plus `prefix` must equal the entry's mount."
)


def placement_module(
    ir: ContractIR,
    layout: ApiLayout,
    proof_models: Mapping[str, str],
    routes: Sequence[RouteEntry],
    mount: str,
    views: ViewsMode,
) -> str:
    """`routes` are named by path, in registration order; `proof_models` names the `<Op>Proofs` class of each operation
    whose body has proofs."""
    module = PythonModule(f"The Django Ninja placement of api '{ir.api.id}'.")
    module.imported("collections.abc", _ABC)
    module.imported("dataclasses", "_dataclasses")
    module.imported("typing", "_typing")
    module.imported("django.http", _HTTP)
    module.imported("ninja", _NINJA)
    module.imported("seampact.ninja.runtime", _RUNTIME)
    module.imported("seampact.hooks", _HOOKS)
    root_names = [layout.contract_error, *(credentials.class_name for credentials in layout.credentials.values())]
    operations = [operation for operation in ir.operations if operation.id in layout.operations]

    for operation in operations:
        names = layout.operations[operation.id]
        root_names += [names.endpoints, names.request, names.result, names.errors, *names.responses.values()]

    head = [f"GENERATED_BY: _typing.Final = {string_literal(RUNTIME_VERSION)}"]
    local_modules = [_CONTRACT_MODULE, _SCHEMAS_MODULE] if proof_models else [_CONTRACT_MODULE]
    module.add_block(with_local_imports(local_modules, root_names, head))
    module.add_block(_placement(ir, layout, routes, mount, views))
    module.add_block(_handler_factories(layout))
    module.add_block(unexpected_error_listener(ir.api.id, _HOOKS, layout))

    for operation in operations:
        module.add_block(_handler_call(layout, operation.id, views))

    for route in routes:
        module.add_block(_view(layout, route, views))

    module.add_block(_bind(ir, layout, proof_models, routes))

    return module.text()


def router_path(route: RouteEntry, mount: str) -> str:
    """The route's path below the router's prefix, which with the URLconf's prefix makes `mount`."""
    mount_depth = len(mount.split("/")) - 1 if mount else 0

    return "".join(
        "/" + (segment.text if segment.attribute is None else f"{{{PATH_ARGUMENT_PREFIX}{segment.attribute}}}")
        for segment in route.segments[mount_depth:]
    )


def _placement(
    ir: ContractIR, layout: ApiLayout, routes: Sequence[RouteEntry], mount: str, views: ViewsMode
) -> list[str]:
    route_lines: list[str] = []

    for route in routes:
        arguments = [
            string_literal(route.operation_id),
            string_literal(route.name),
            string_literal(router_path(route, mount)),
            tuple_literal(route.methods),
        ]
        route_lines += bracketed(INDENT * 2, f"{_RUNTIME}.OperationRoute", arguments, ",")

    return [
        f"PLACEMENT: _typing.Final = {_RUNTIME}.ApiPlacement(",
        f"{INDENT}api={string_literal(ir.api.id)},",
        f"{INDENT}generated_by=GENERATED_BY,",
        f"{INDENT}mount={string_literal(mount)},",
        f"{INDENT}routes=(",
        *route_lines,
        f"{INDENT}),",
        f"{INDENT}error_base={layout.contract_error},",
        f"{INDENT}views={_RUNTIME}.ViewsMode.{views.name},",
        *credentials_types(_RUNTIME, layout),
        ")",
    ]


def _handler_factories(layout: ApiLayout) -> list[str]:
    lines = [
        "@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)",
        f"class {layout.handler_factories}:",
        f'{INDENT}"""Builds each endpoints protocol\'s handlers from the HttpRequest; None fails the boot."""',
        "",
    ]
    lines += [
        f"{INDENT}{attribute}: {_RUNTIME}.Factory[{endpoints}] | None"
        for endpoints, attribute in layout.endpoints_owners().items()
    ]

    return lines


def _handler_call(layout: ApiLayout, operation_id: str, views: ViewsMode) -> list[str]:
    """A sync call narrows the method's result itself: the checkers cannot infer the result union through a generic
    helper."""
    names = layout.operations[operation_id]
    parameters = [f"endpoints: {names.endpoints}", f"request: {names.request}"]

    if views is ViewsMode.ASYNC:
        return [
            *bracketed("", f"async def {_CALL_PREFIX}{names.method}", parameters, f" -> {names.result}:"),
            f"{INDENT}return await {_RUNTIME}.call_handler_async(endpoints.{names.method}, request)",
        ]

    return [
        *bracketed("", f"def {_CALL_PREFIX}{names.method}", parameters, f" -> {names.result}:"),
        f"{INDENT}result = endpoints.{names.method}(request)",
        "",
        f"{INDENT}if isinstance(result, {_ABC}.Awaitable):",
        f"{INDENT * 2}raise {_RUNTIME}.async_handler_error(endpoints.{names.method}, result)",
        "",
        f"{INDENT}return result",
    ]


def _view(layout: ApiLayout, route: RouteEntry, views: ViewsMode) -> list[str]:
    """Ninja reads one `str` parameter per placeholder, which it cannot refuse; the view leaves them to the boundary's
    raw decoding."""
    names = layout.operations[route.operation_id]
    parameters = [
        f"request: {_HTTP}.HttpRequest",
        *(f"{PATH_ARGUMENT_PREFIX}{segment.attribute}: str" for segment in route.segments if segment.attribute),
    ]
    operation = string_literal(route.operation_id)

    if views is ViewsMode.ASYNC:
        return [
            *bracketed("", f"async def {_VIEW_PREFIX}{names.method}", parameters, f" -> {_HTTP}.HttpResponse:"),
            f"{INDENT}return await {_RUNTIME}.serve_operation_async(request, PLACEMENT, {operation})",
        ]

    return [
        *bracketed("", f"def {_VIEW_PREFIX}{names.method}", parameters, f" -> {_HTTP}.HttpResponse:"),
        f"{INDENT}return {_RUNTIME}.serve_operation(request, PLACEMENT, {operation})",
    ]


def _bind(
    ir: ContractIR, layout: ApiLayout, proof_models: Mapping[str, str], routes: Sequence[RouteEntry]
) -> list[str]:
    def factories(hook: str) -> str:
        return f"{_ABC}.Mapping[str, {_RUNTIME}.Factory[{_HOOKS}.{hook}]] | None = None"

    parameters = [
        f"api: {_NINJA}.NinjaAPI",
        "*",
        "prefix: str",
        f"handlers: {layout.handler_factories}",
        f"authenticate: {factories('AuthenticateHook')}",
        f"deciders: {factories('DecideHook')}",
        f"scope_resolvers: {factories('ResolveScopeHook')}",
        f"idempotency_store: {_RUNTIME}.Factory[{_HOOKS}.IdempotencyStore] | None = None",
        f"on_unexpected_error: {_RUNTIME}.Factory[{layout.unexpected_error_listener}] | None = None",
        f"access: {_ABC}.Mapping[str, {_RUNTIME}.AccessSettings] | None = None",
        f"responses: {_RUNTIME}.ResponsesMode | None = None",
        "body_validation: bool | None = None",
        f"operations: {_ABC}.Mapping[str, {_RUNTIME}.OperationSettings] | None = None",
        "public_origin: str | None = None",
    ]
    settings = [
        "responses=responses",
        "body_validation=body_validation",
        "operations=operations or {}",
        "public_origin=public_origin",
    ]
    lines = [
        *bracketed("", f"def {layout.bind_function}", parameters, " -> None:"),
        f'{INDENT}"""{_BIND_DOC}"""',
        f"{INDENT}binding = {_RUNTIME}.api_binding(",
        f"{INDENT * 2}PLACEMENT,",
        f"{INDENT * 2}_{_CONTRACT_MODULE}.CONTRACT,",
        f"{INDENT * 2}api,",
        f"{INDENT * 2}prefix=prefix,",
        f"{INDENT * 2}authenticate=authenticate or {{}},",
        f"{INDENT * 2}deciders=deciders or {{}},",
        f"{INDENT * 2}scope_resolvers=scope_resolvers or {{}},",
        f"{INDENT * 2}idempotency_store=idempotency_store,",
        f"{INDENT * 2}on_unexpected_error=on_unexpected_error,",
        f"{INDENT * 2}access=access or {{}},",
        *bracketed(INDENT * 2, f"settings={_RUNTIME}.RunSettings", settings, ","),
        f"{INDENT})",
        "",
    ]

    for route in routes:
        lines += _add_operation(layout, route.operation_id, proof_models.get(route.operation_id))

    return [*lines, "", f"{INDENT}{_RUNTIME}.bind_api(binding)"]


def _add_operation(layout: ApiLayout, operation_id: str, proof_model: str | None) -> list[str]:
    """One `add_operation` call, split as ruff splits it."""
    names = layout.operations[operation_id]
    proofs = None if proof_model is None else f"_{_SCHEMAS_MODULE}.{proof_model}"
    types = operation_types_arguments(layout, operation_id, proofs)
    arguments = [
        "binding",
        string_literal(operation_id),
        f"{_VIEW_PREFIX}{names.method}",
        f"handlers.{names.owner_attribute}",
        f"{_CALL_PREFIX}{names.method}",
    ]

    return add_operation_call(_RUNTIME, arguments, types)
