"""A live app of the golden `tasks` api for the tests that call it through `TestClient`: every handler factory, the
`user` authenticate factory the test chooses (a FastAPI dependency, so it may take `Security` schemes), and the app's
own setup run before `bind_tasks()`. The boot check runs as the boundary runs it; `served()` passes it by hand for the
golden api's features the test does not wire."""

import importlib
import uuid
from collections.abc import Callable
from types import ModuleType
from typing import Final

import fastapi

from seampact.fastapi.runtime import ApiBinding
from seampact.hooks import AuthenticateHook, AuthenticateRequest, AuthenticateResult, authenticate_result

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


class ChannelsEndpoints:
    """`listChannels` answers one empty page with a next cursor, so its links are written."""

    def list_channels(self, request: object, /) -> object:
        operations = golden_module("operations")

        return operations.ListChannelsResponse200(operations.ListChannelsPage(items=[], next_cursor=NEXT_CURSOR))


def bound_app(
    user_hook: Callable[..., AuthenticateHook] = AdmittedUser,
    *,
    before_bind: Callable[[fastapi.FastAPI], None] | None = None,
    **settings: object,
) -> tuple[fastapi.FastAPI, ApiBinding]:
    """The app the test builds: `before_bind` adds its own middleware and routes, then `bind_tasks()` comes last."""
    app = fastapi.FastAPI()

    if before_bind is not None:
        before_bind(app)

    placement = golden_module("fastapi")
    bind: Callable[..., None] = placement.bind_tasks
    handlers = placement.TasksHandlerFactories(
        tasks=object, drafts=object, channels=ChannelsEndpoints, preferences=object, app=object, hooks=object
    )
    bind(app, handlers=handlers, authenticate={USER_IDENTITY: user_hook}, **settings)
    binding = app.user_middleware[0].kwargs["binding"]
    assert isinstance(binding, ApiBinding)

    return app, binding


def served(
    user_hook: Callable[..., AuthenticateHook] = AdmittedUser,
    *,
    before_bind: Callable[[fastapi.FastAPI], None] | None = None,
    **settings: object,
) -> fastapi.FastAPI:
    """The app with the boot check passed by hand: the golden api's other hooks are not wired here."""
    app, binding = bound_app(user_hook, before_bind=before_bind, **settings)
    binding.boot_problems = []

    return app
