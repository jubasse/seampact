"""A live app of the golden `tasks` api for the tests that call it through `TestClient`: every handler factory, the
`user` authenticate factory the test chooses (a FastAPI dependency, so it may take `Security` schemes), the handler
factories it replaces, and the app's own setup run before `bind_tasks()`. The boot check runs as the boundary runs it;
`served()` passes it by hand for the golden api's features the test does not wire."""

import importlib
import uuid
from collections.abc import Callable, Mapping
from types import MappingProxyType, ModuleType
from typing import Final

import fastapi

from seampact.codegen.runtime.hook_check import hook_needs
from seampact.fastapi.runtime import ApiBinding
from seampact.hooks import (
    AuthenticateHook,
    AuthenticateRequest,
    AuthenticateResult,
    Decision,
    IdempotencyClaim,
    RequirementRequest,
    ResolvedScope,
    ResolveScopeRequest,
    ScopeResolution,
    StoredResponse,
    authenticate_result,
    decision,
    idempotency_begin,
    scope_id_source,
    scope_resolution,
)

GOLDEN_API: Final = "fastapi_tests.golden.reference.tasks"
USER_IDENTITY: Final = "user"
CALLER_ID: Final = uuid.UUID("30000000-0000-4000-8000-000000000001")
NEXT_CURSOR: Final = "cursor-of-the-next-page"


def golden_module(name: str) -> ModuleType:
    return importlib.import_module(f"{GOLDEN_API}.{name}")


class AdmittedUser:
    """Admits every caller as the same user."""

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        principal = golden_module("schemas").UserPrincipal(user_id=CALLER_ID)

        return authenticate_result.Authenticated(principal=principal)


HOOK_FAILURE: Final = "the hook broke"


class AllowingHooks:
    """Admits every caller, resolves every scope and allows every right; the hook named in `throwing` raises instead."""

    throwing = ""

    def authenticate(self, request: AuthenticateRequest, /) -> AuthenticateResult:
        self._throw_if_named("authenticate")

        return AdmittedUser().authenticate(request)

    def resolve_scope(self, request: ResolveScopeRequest, /) -> ScopeResolution:
        self._throw_if_named("resolve_scope")
        source = request.source
        assert isinstance(source, scope_id_source.Declared)

        return scope_resolution.Resolved(resolved=ResolvedScope(scope=request.scope, id=source.id))

    def decide(self, request: RequirementRequest, /) -> Decision:
        self._throw_if_named("decide")

        return decision.Allowed()

    def _throw_if_named(self, hook: str) -> None:
        if self.throwing == hook:
            raise RuntimeError(HOOK_FAILURE)


class ForgetfulIdempotencyStore:
    """Starts every request and keeps nothing."""

    def begin(self, claim: IdempotencyClaim, /) -> idempotency_begin.Started:
        return idempotency_begin.Started()

    def complete(self, key: str, response: StoredResponse, /) -> None:
        return None

    def abandon(self, key: str, /) -> None:
        return None


class ChannelsEndpoints:
    """`listChannels` answers one empty page with a next cursor, so its links are written."""

    def list_channels(self, request: object, /) -> object:
        operations = golden_module("operations")

        return operations.ListChannelsResponse200(operations.ListChannelsPage(items=[], next_cursor=NEXT_CURSOR))


def bound_app(
    user_hook: Callable[..., AuthenticateHook] = AdmittedUser,
    *,
    before_bind: Callable[[fastapi.FastAPI], None] | None = None,
    handlers: Mapping[str, Callable[[], object]] = MappingProxyType({}),
    **settings: object,
) -> tuple[fastapi.FastAPI, ApiBinding]:
    """The app the test builds: `before_bind` adds its own middleware and routes, then `bind_tasks()` comes last."""
    app = fastapi.FastAPI()

    if before_bind is not None:
        before_bind(app)

    placement = golden_module("fastapi")
    bind: Callable[..., None] = placement.bind_tasks
    factories = placement.TasksHandlerFactories(
        **{
            "tasks": object,
            "drafts": object,
            "channels": ChannelsEndpoints,
            "preferences": object,
            "app": object,
            "hooks": object,
            **handlers,
        }
    )
    bind(app, handlers=factories, authenticate={USER_IDENTITY: user_hook}, **settings)
    binding = app.user_middleware[0].kwargs["binding"]
    assert isinstance(binding, ApiBinding)

    return app, binding


def served(
    user_hook: Callable[..., AuthenticateHook] = AdmittedUser,
    *,
    before_bind: Callable[[fastapi.FastAPI], None] | None = None,
    handlers: Mapping[str, Callable[[], object]] = MappingProxyType({}),
    **settings: object,
) -> fastapi.FastAPI:
    """The app with the boot check passed by hand: the golden api's other hooks are not wired here."""
    app, binding = bound_app(user_hook, before_bind=before_bind, handlers=handlers, **settings)
    binding.boot_problems = []

    return app


def served_with_every_hook(
    hooks: AllowingHooks,
    *,
    handlers: Mapping[str, Callable[[], object]] = MappingProxyType({}),
    listener: Callable[[], object] | None = None,
) -> fastapi.FastAPI:
    """`served()` with an authenticate hook, every decider and scope resolver of the contract built from `hooks`, an
    idempotency store that keeps nothing and, when given, the unexpected-error listener."""
    needs = hook_needs(golden_module("contract").CONTRACT)

    return served(
        lambda: hooks,
        handlers=handlers,
        deciders={name: lambda: hooks for name in needs.deciders},
        scope_resolvers={name: lambda: hooks for name in needs.scopes},
        idempotency_store=ForgetfulIdempotencyStore,
        on_unexpected_error=listener,
    )
