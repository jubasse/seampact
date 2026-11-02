"""The boot check of one api (ADR 0026 "The boot check"), run by the boundary on `lifespan.startup`, else once on the
first request. It lists every problem at once: the runtime version (G3), the hooks, the handler factories, the
operation features this release does not serve, a contract request another route would take (Starlette's public
`matches()` over `app.routes`), an app route under a base path that `frameworkRoutes` does not allow-list, the boundary
not first in `app.user_middleware`, an `HTTPException` handler added after bind, and a dependency override of a
generated dependency."""

import re
from collections.abc import Iterable, Sequence
from typing import Final

from starlette.routing import BaseRoute, Match

from seampact.codegen.runtime.hook_check import HookFixes, hook_problems
from seampact.codegen.runtime.version import other_version_problem
from seampact.fastapi.runtime.api_binding import ApiBinding
from seampact.fastapi.runtime.exception_map import is_wrapped, takes_http_exception
from seampact.fastapi.runtime.placement import FrameworkRouteRule, FrameworkRoutesCheck, HooksCheck
from seampact.fastapi.runtime.unserved import unserved_features, unserved_problem

_SAMPLE_SEGMENT: Final = "seampact"
_PLACEHOLDER: Final = re.compile(r"\{[^{}]+\}")
_CONTRACT_ROUTE_PREFIX: Final = "seampact."


class BootCheckError(RuntimeError):
    def __init__(self, api: str, problems: Sequence[str]) -> None:
        super().__init__(f"seampact: the api '{api}' cannot start:\n- " + "\n- ".join(problems))
        self.api = api
        self.problems = list(problems)


def boot_problems(binding: ApiBinding) -> list[str]:
    placement = binding.placement
    version = other_version_problem(placement.api, placement.generated_by)

    if not placement.boot_check.enabled:
        return [] if version is None else [version]

    problems = [] if version is None else [version]

    if placement.boot_check.hooks is HooksCheck.ERROR:
        problems += _hook_problems(binding)

    problems += _handler_problems(binding)
    problems += _route_problems(binding)

    if placement.boot_check.framework_routes is not FrameworkRoutesCheck.OFF:
        problems += _framework_route_problems(binding)

    problems += _middleware_problems(binding)
    problems += _exception_handler_problems(binding)

    return problems + override_problems(binding)


def override_problems(binding: ApiBinding) -> list[str]:
    """A dependency override keyed by a generated dependency reaches the handler without steps 2 to 8."""
    overridden = [dependency for dependency in binding.dependencies if dependency in binding.app.dependency_overrides]

    return [
        f"app.dependency_overrides replaces the generated dependency {dependency.__name__}, which would reach the "
        "handler without the contract's checks; override the handler factory or its own dependencies instead"
        for dependency in overridden
    ]


def _hook_problems(binding: ApiBinding) -> list[str]:
    bind = f"bind_{binding.api}()"
    fixes = HookFixes(
        authenticate=f"pass its factory in `authenticate=` of {bind}",
        decider=f"pass its factory in `deciders=` of {bind}",
        scope_resolver=f"pass its factory in `scope_resolvers=` of {bind}",
    )

    return hook_problems(
        binding.contract,
        identities=list(binding.hooks.authenticate),
        scopes=list(binding.hooks.scope_resolvers),
        deciders=list(binding.hooks.deciders),
        fixes=fixes,
    )


def _handler_problems(binding: ApiBinding) -> list[str]:
    problems: list[str] = []

    for route in binding.placement.routes:
        operation_id = route.operation_id

        if binding.handler_factories.get(operation_id) is None:
            problems.append(
                f"operation '{operation_id}' has no handler factory: pass it in the handlers of bind_{binding.api}()"
            )

        features = unserved_features(binding.contract, operation_id)

        if features:
            problems.append(unserved_problem(binding.api, operation_id, features))

    return problems


def _route_problems(binding: ApiBinding) -> list[str]:
    """The first full match of each contract request over `app.routes` must be the entry the api's router became."""
    if binding.route_entry is None:
        return [f"bind_{binding.api}() did not include the api's router; call it once, last"]

    routes = binding.app.routes if binding.target is binding.app else binding.target.routes
    problems: list[str] = []

    for route in binding.placement.routes:
        path = _PLACEHOLDER.sub(_SAMPLE_SEGMENT, route.path)

        for method in route.methods:
            winner = _first_full_match(routes, method, path)

            if winner is binding.route_entry or _allow_listed(binding.placement.framework_routes, winner, method):
                continue

            taker = "no route" if winner is None else f"the route {_describe(winner)}"
            problems.append(
                f"operation '{route.operation_id}': {taker} takes '{method} {path}' before the contract route; remove "
                "it, register it after bind, or allow-list it in the entry's frameworkRoutes"
            )

    return problems


def _first_full_match(routes: Iterable[BaseRoute], method: str, path: str) -> BaseRoute | None:
    scope = {"type": "http", "method": method, "path": path, "root_path": "", "headers": [], "query_string": b""}

    for route in routes:
        match, _ = route.matches(scope)

        if match is Match.FULL:
            return route

    return None


def _framework_route_problems(binding: ApiBinding) -> list[str]:
    """An app route at or under one of the api's base paths that no bind made and `frameworkRoutes` does not list."""
    docs = {
        binding.app.docs_url,
        binding.app.redoc_url,
        binding.app.openapi_url,
        binding.app.swagger_ui_oauth2_redirect_url,
    }
    problems: list[str] = []

    for route in _app_routes(binding.app.routes):
        path = getattr(route, "path", None)
        name = getattr(route, "name", None) or ""

        if not isinstance(path, str) or path in docs or name.startswith(_CONTRACT_ROUTE_PREFIX):
            continue

        base = next((base for base in binding.contract.base_paths() if _under(path, base)), None)

        if base is None:
            continue

        methods = sorted(getattr(route, "methods", None) or [])

        if all(_allow_listed(binding.placement.framework_routes, route, method) for method in methods or [""]):
            continue

        problems.append(
            f"the app route '{path}' sits under the api's base path '{base}' and is not a contract route; remove it, "
            "or allow-list it in the entry's frameworkRoutes with a reason"
        )

    return problems


def _app_routes(routes: Iterable[BaseRoute]) -> list[BaseRoute]:
    """The app's routes, an included router's entry read through to its own routes."""
    flat: list[BaseRoute] = []

    for route in routes:
        nested = getattr(route, "routes", None)

        if nested is not None and not hasattr(route, "path_regex"):
            flat += _app_routes(nested)
        else:
            flat.append(route)

    return flat


def _middleware_problems(binding: ApiBinding) -> list[str]:
    # Every middleware outside this boundary must be another api's boundary, each added with its binding.
    for middleware in binding.app.user_middleware:
        bound = middleware.kwargs.get("binding")

        if bound is binding:
            return []

        if not isinstance(bound, ApiBinding):
            break

    return [
        f"the '{binding.api}' boundary is not the outermost middleware: a middleware was added after "
        f"bind_{binding.api}(); add the app's middleware before the call"
    ]


def _exception_handler_problems(binding: ApiBinding) -> list[str]:
    return [
        f"the exception handler for {key!r} was added after bind_{binding.api}(), so contract routes cannot map its "
        "HTTPException to a role; register it before the call"
        for key, handler in binding.app.exception_handlers.items()
        if takes_http_exception(key) and not is_wrapped(handler)
    ]


def _allow_listed(rules: Sequence[FrameworkRouteRule], route: object, method: str) -> bool:
    path = getattr(route, "path", None)

    if not isinstance(path, str):
        return False

    return any(_path_rule(rule.path).fullmatch(path) and rule.method in (None, method) for rule in rules)


def _path_rule(pattern: str) -> re.Pattern[str]:
    """`*` takes one segment and `**` any number."""
    parts = [re.escape(part).replace(r"\*", "[^/]*") for part in pattern.split("**")]

    return re.compile(".*".join(parts))


def _under(path: str, base: str) -> bool:
    return base == "" or path == base or path.startswith(base + "/") or path.startswith(base + "{")


def _describe(route: BaseRoute) -> str:
    path = getattr(route, "path", None)
    name = getattr(route, "name", None)

    return f"'{path}'" if name is None else f"'{path}' ({name})"
