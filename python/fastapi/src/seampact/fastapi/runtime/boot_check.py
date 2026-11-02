"""The boot check of one api (ADR 0026 "The boot check"), run by the boundary on `lifespan.startup`, else once on the
first request. It lists every problem at once: the runtime version (G3), a FastAPI minor or a Starlette or Pydantic
major `generate` did not accept, the hooks, the handler factories, the public origin,
a contract request another route would take (Starlette's public `matches()` over `app.routes`, then over an
`APIRouter` target's routes), an app route or a `frontend()` route under a base path that `frameworkRoutes` does not
allow-list, the boundary not first in `app.user_middleware`, an `HTTPException` handler added after bind, and a
dependency override of a generated dependency."""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Final

from starlette.routing import BaseRoute, Host, Match, Mount, Route

from seampact.codegen.runtime.framework_routes import FrameworkRouteRule, allow_listed, base_path_of
from seampact.codegen.runtime.framework_versions import framework_version_problems
from seampact.codegen.runtime.hook_check import HookFixes, hook_problems
from seampact.codegen.runtime.idempotency import enforces_idempotency
from seampact.codegen.runtime.public_origin import public_origin_problem
from seampact.codegen.runtime.version import other_version_problem
from seampact.fastapi.runtime.api_binding import ApiBinding
from seampact.fastapi.runtime.exception_map import is_wrapped, takes_http_exception
from seampact.fastapi.runtime.placement import FrameworkRoutesCheck, HooksCheck

_SAMPLE_SEGMENT: Final = "seampact"
_PLACEHOLDER: Final = re.compile(r"\{[^{}]+\}")
_CONTRACT_ROUTE_PREFIX: Final = "seampact."
_FRONTEND_ROUTES: Final = "_frontend_routes"
_FRONTEND_METHOD: Final = "GET"
_EFFECTIVE_ROUTES: Final = "effective_route_contexts"


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
    problems += framework_version_problems(placement.frameworks, placement.api)

    if placement.boot_check.hooks is HooksCheck.ERROR:
        problems += _hook_problems(binding)

    problems += _handler_problems(binding)
    problems += _public_origin_problems(binding)
    problems += _route_problems(binding)

    if placement.boot_check.framework_routes is not FrameworkRoutesCheck.OFF:
        problems += _framework_route_problems(binding)
        problems += _frontend_route_problems(binding)

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

    problems = hook_problems(
        binding.contract,
        identities=list(binding.hooks.authenticate),
        scopes=list(binding.hooks.scope_resolvers),
        deciders=list(binding.hooks.deciders),
        fixes=fixes,
    )
    keyed = [
        route.operation_id
        for route in binding.placement.routes
        if enforces_idempotency(binding.contract, route.operation_id)
    ]

    if keyed and binding.hooks.idempotency_store is None:
        problems.append(
            f"no idempotency store for the operations {', '.join(keyed)}: pass its factory in `idempotency_store=` "
            f"of {bind}"
        )

    return problems


def _handler_problems(binding: ApiBinding) -> list[str]:
    problems: list[str] = []

    for route in binding.placement.routes:
        operation_id = route.operation_id

        if binding.handler_factories.get(operation_id) is None:
            problems.append(
                f"operation '{operation_id}' has no handler factory: pass it in the handlers of bind_{binding.api}()"
            )

    return problems


def _public_origin_problems(binding: ApiBinding) -> list[str]:
    setting = f"the `public_origin` argument of bind_{binding.api}()"
    problem = public_origin_problem(binding.contract, setting, binding.settings.public_origin)

    return [] if problem is None else [problem]


def _route_problems(binding: ApiBinding) -> list[str]:
    """The first full match of each contract request over `app.routes` must be the entry the api's router became.
    With an `APIRouter` target, it must be no `Route`, `Mount` or `Host` of the app, and over `target.routes` the
    entry: a prefix on the target or on a router it joins leaves the contract path unmatched."""
    if binding.route_entry is None:
        return [f"bind_{binding.api}() did not include the api's router; call it once, last"]

    problems: list[str] = []

    for route in binding.placement.routes:
        path = _PLACEHOLDER.sub(_SAMPLE_SEGMENT, route.path)

        for method in route.methods:
            request = _ContractRequest(route.operation_id, method, path)
            winner = _first_full_match(binding.app.routes, method, path)

            if _allow_listed(binding.placement.framework_routes, winner, method):
                continue

            if binding.target is not binding.app:
                problems += _router_target_problems(binding, request, winner)
            elif winner is not binding.route_entry:
                problems.append(request.taken_by(winner))

    return problems


@dataclass(frozen=True, slots=True)
class _ContractRequest:
    operation_id: str
    method: str
    path: str

    def taken_by(self, winner: BaseRoute | None) -> str:
        taker = "no route" if winner is None else f"the route {_describe(winner)}"

        return (
            f"operation '{self.operation_id}': {taker} takes '{self.method} {self.path}' before the contract route; "
            "remove it, register it after bind, or allow-list it in the entry's frameworkRoutes"
        )


def _router_target_problems(binding: ApiBinding, request: _ContractRequest, app_winner: BaseRoute | None) -> list[str]:
    if app_winner is None:
        return [
            f"operation '{request.operation_id}': no route of the app takes '{request.method} {request.path}'; "
            f"include the router passed to bind_{binding.api}() in the app with no prefix on it or on a router it "
            "joins, and set the entry's `mount` for a prefix"
        ]

    if isinstance(app_winner, Route | Mount | Host):
        return [request.taken_by(app_winner)]

    target_winner = _first_full_match(binding.target.routes, request.method, request.path)

    return [] if target_winner is binding.route_entry else [request.taken_by(target_winner)]


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

        base = base_path_of(path, binding.contract.base_paths())

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


def _frontend_route_problems(binding: ApiBinding) -> list[str]:
    """A `frontend()` route at or under a base path. FastAPI keeps those routes apart from `app.routes`, in the app
    router's `_frontend_routes` group; a test of the target fails by name if a FastAPI minor moves them."""
    group = getattr(binding.app.router, _FRONTEND_ROUTES, None)
    problems: list[str] = []

    for route in getattr(group, "routes", None) or []:
        path = getattr(route, "path", None)
        base = None if not isinstance(path, str) else base_path_of(path, binding.contract.base_paths())

        if base is None or _allow_listed(binding.placement.framework_routes, route, _FRONTEND_METHOD):
            continue

        problems.append(
            f"the frontend() route '{path}' sits under the api's base path '{base}'; serve the frontend outside it, or "
            "allow-list it in the entry's frameworkRoutes with a reason"
        )

    return problems


def _app_routes(routes: Iterable[object]) -> list[object]:
    """The app's routes, an included router's entry read through to its own routes. FastAPI 0.162 keeps an included
    router as one `_IncludedRouter` entry whose `effective_route_contexts()` yields each route of its tree, nested
    routers included, with its full prefixed path, name and methods."""
    flat: list[object] = []

    for route in routes:
        contexts = getattr(route, _EFFECTIVE_ROUTES, None)
        nested = getattr(route, "routes", None)

        if callable(contexts):
            flat += _app_routes(_iterated(contexts()))
        elif nested is not None and not hasattr(route, "path_regex"):
            flat += _app_routes(_iterated(nested))
        else:
            flat.append(route)

    return flat


def _iterated(values: object) -> list[object]:
    if not isinstance(values, Iterable):
        return []

    return [value for value in values]


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

    return isinstance(path, str) and allow_listed(rules, path, method)


def _describe(route: BaseRoute) -> str:
    path = getattr(route, "path", None)
    name = getattr(route, "name", None)

    return f"'{path}'" if name is None else f"'{path}' ({name})"
