"""What the generated placement of one api declares for the runtime (ADR 0026 "Placement" and "Options and
registration"): its routes, its contract exception base, the run-time defaults the target options set, the boot
check switches, the framework routes the entry allows, the framework versions `generate` accepted, each identity's
credentials class, and the types of the factories `bind_<api>()` takes."""

from collections.abc import AsyncIterator, Awaitable, Callable, Iterator, Mapping
from dataclasses import dataclass, field
from enum import StrEnum

import fastapi

from seampact.codegen.runtime.access_steps import CredentialsType
from seampact.codegen.runtime.framework_routes import FrameworkRouteRule
from seampact.codegen.runtime.framework_versions import AcceptedFramework
from seampact.codegen.runtime.native_docs import NativeDocs
from seampact.codegen.runtime.reply_verdict import FrameworkEtagMode, ResponsesMode
from seampact.fastapi.runtime.native_docs import FrameworkDocs
from seampact.hooks import AuthenticateHook, DecideHook, IdempotencyStore, ResolveScopeHook, UnexpectedErrorListener

type App = fastapi.FastAPI
"""The app the boundary and the exception handlers belong to."""

type BindTarget = fastapi.FastAPI | fastapi.APIRouter
"""Where `bind_<api>()` includes the api's router: the app, or an `APIRouter` of the app's choosing."""

type Factory[T] = Callable[..., T | Awaitable[T] | Iterator[T] | AsyncIterator[T]]
"""A FastAPI dependency that gives a `T`: a plain or `async` function, or a generator of one, taking the app's own
dependencies."""


class FrameworkRoutesCheck(StrEnum):
    """`artefacts.bootCheck.frameworkRoutes`: checked, off, or strict."""

    ON = "on"
    OFF = "off"
    STRICT = "strict"


class HooksCheck(StrEnum):
    """`artefacts.bootCheck.hooks`: a missing hook fails the boot, or is not checked."""

    ERROR = "error"
    OFF = "off"


@dataclass(frozen=True, slots=True, kw_only=True)
class BootCheckSwitches:
    enabled: bool
    framework_routes: FrameworkRoutesCheck
    hooks: HooksCheck


@dataclass(frozen=True, slots=True, kw_only=True)
class TargetDefaults:
    """The run-time defaults the target options set; `bind_<api>()`'s keyword arguments override them."""

    responses: ResponsesMode
    body_validation: bool
    framework_etag: FrameworkEtagMode
    catch_all: bool


@dataclass(frozen=True, slots=True)
class OperationRoute:
    """One contract route: the operation, the route name, the path in Starlette's syntax under the entry's `mount`,
    and its methods (`GET` also serving `HEAD`)."""

    operation_id: str
    name: str
    path: str
    methods: tuple[str, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class ApiPlacement:
    api: str
    generated_by: str
    mount: str
    routes: tuple[OperationRoute, ...]
    error_base: type[Exception]
    defaults: TargetDefaults
    boot_check: BootCheckSwitches
    framework_routes: tuple[FrameworkRouteRule, ...]
    frameworks: tuple[AcceptedFramework, ...]
    credentials: Mapping[str, CredentialsType]
    framework_docs: FrameworkDocs = FrameworkDocs.KEEP
    native_docs: NativeDocs | None = None
    _routes_by_operation: dict[str, OperationRoute] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "_routes_by_operation", {route.operation_id: route for route in self.routes})

    def route(self, operation_id: str) -> OperationRoute:
        """Raises `LookupError` for an operation the api does not keep."""
        route = self._routes_by_operation.get(operation_id)

        if route is None:
            raise LookupError(f"seampact: the api '{self.api}' has no contract route for operation '{operation_id}'.")

        return route


@dataclass(frozen=True, slots=True, kw_only=True)
class HookFactories:
    """The hook factories `bind_<api>()` takes, keyed by the contract's names: `authenticate` per identity,
    `deciders` per right or rule, `scope_resolvers` per scope; `on_unexpected_error` hears of each failure answered with
    the api's 500."""

    authenticate: Mapping[str, Factory[AuthenticateHook]]
    deciders: Mapping[str, Factory[DecideHook]]
    scope_resolvers: Mapping[str, Factory[ResolveScopeHook]]
    idempotency_store: Factory[IdempotencyStore] | None
    on_unexpected_error: Factory[UnexpectedErrorListener] | None
