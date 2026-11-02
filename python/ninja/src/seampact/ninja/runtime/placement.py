"""The declarations of one api's Ninja placement, which the generated `ninja` module writes: its contract routes, how
its views run, the factories `bind_<api>()` takes, and what Ninja runs before a view per access kind."""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field

from django.http import HttpRequest
from ninja.throttling import BaseThrottle

from seampact.codegen.runtime.access_steps import CredentialsType
from seampact.ninja.views_mode import ViewsMode

type Factory[T] = Callable[[HttpRequest], T]
"""Builds a `T` from the request: an endpoints protocol's handlers, or a hook."""

type NinjaAuth = Callable[[HttpRequest], object]
"""One of Ninja's `auth=` callables, such as an `HttpBearer` instance."""


@dataclass(frozen=True, slots=True)
class OperationRoute:
    """One contract operation as the api's Router declares it: its URL name (its path's first operation's), its path
    below the router's prefix with one `{path_<attribute>}` per placeholder, and its methods, `GET` with `HEAD`."""

    operation_id: str
    name: str
    path: str
    methods: tuple[str, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class AccessSettings:
    """What Ninja runs before the view of an operation of one access kind: its `auth=` and its throttles. The default
    runs neither, so a `NinjaAPI(auth=...)` set app-wide never refuses a public operation."""

    auth: NinjaAuth | Sequence[NinjaAuth] | None = None
    throttle: Sequence[BaseThrottle] = ()


@dataclass(frozen=True, slots=True, kw_only=True)
class ApiPlacement:
    api: str
    generated_by: str
    mount: str
    routes: tuple[OperationRoute, ...]
    error_base: type[Exception]
    views: ViewsMode
    credentials: Mapping[str, CredentialsType]
    _routes_by_operation: dict[str, OperationRoute] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "_routes_by_operation", {route.operation_id: route for route in self.routes})

    def route(self, operation_id: str) -> OperationRoute:
        """Raises `LookupError` for an operation the api does not keep."""
        route = self._routes_by_operation.get(operation_id)

        if route is None:
            raise LookupError(f"seampact: the api '{self.api}' has no contract route for operation '{operation_id}'.")

        return route
