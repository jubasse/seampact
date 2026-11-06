"""The FastAPI consumer of the http suite: the `tasks` api bound with the developer's handlers and the hook doubles,
less what the boot variant (`SEAMPACT_SUITE_BOOT_VARIANT`) leaves out, and the other apis of the reference contract,
beside the suite's control routes."""

import logging
from pathlib import Path
from typing import Final

from control import control_router
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from generated.tasks.fastapi import TasksHandlerFactories, bind_tasks
from generated.tasks_absolute_urls.fastapi import TasksAbsoluteUrlsHandlerFactories, bind_tasks_absolute_urls
from generated.tasks_devices.fastapi import TasksDevicesHandlerFactories, bind_tasks_devices
from generated.tasks_optional_auth.fastapi import TasksOptionalAuthHandlerFactories, bind_tasks_optional_auth
from generated.tasks_service.fastapi import TasksServiceHandlerFactories, bind_tasks_service
from generated.tasks_service_writes.fastapi import TasksServiceWritesHandlerFactories, bind_tasks_service_writes
from handlers import (
    AppHandlers,
    ChannelsHandlers,
    DevicesHandlers,
    DraftsHandlers,
    HooksHandlers,
    InternalHandlers,
    InternalWritesHandlers,
    NotesHandlers,
    PreferencesHandlers,
    TasksHandlers,
    WelcomeHandlers,
)
from hook_doubles import (
    CALLER_SERVICE_RIGHT,
    OVERRIDDEN_RIGHT,
    ChannelResolver,
    DeviceHook,
    OverriddenRightDecider,
    ServiceDecider,
    StripeHook,
    TasksDecider,
    TasksUnexpectedErrors,
)
from hooks import service_hook, user_hook
from seampact_consumer_suite.boot_variant import BootVariant, current_boot_variant, serves_unlisted_route
from seampact_consumer_suite.file_idempotency_store import FileIdempotencyStore
from seampact_consumer_suite.log_lines import SuiteLogHandler
from seampact_consumer_suite.scripted_answers import ScriptedReply
from seampact_consumer_suite.suite_files import SuiteFiles, configure_suite_files

APP_DIRECTORY: Final = Path(__file__).parent
CONTROL_STATE_FILE: Final = "suite-control.json"
CREDENTIALS_FILE: Final = "credentials.json"
IDEMPOTENCY_STORE_FILE: Final = "suite-idempotency.json"
UNLISTED_PATH: Final = "/v1/unlisted"
USER_IDENTITY: Final = "user"
STRIPE_IDENTITY: Final = "stripe"
SERVICE_IDENTITY: Final = "service"
DEVICE_IDENTITY: Final = "device"
# The origin the tasksAbsoluteUrls api writes its absolute URLs from, never the request's Host.
PUBLIC_ORIGIN: Final = "https://api.seampact.test"
# Every right and rule the tasks api's operations ask a decider for.
DECIDED_NAMES: Final = ("tasks.read", "tasks.update", "tasks.seeEffort", "roles", "throttle", "recentAuth")
CHANNEL_SCOPE: Final = "channel"


async def _scripted_reply(_request: Request, failure: Exception) -> JSONResponse:
    if not isinstance(failure, ScriptedReply):
        raise failure

    return JSONResponse(failure.body(), status_code=failure.status, headers=failure.headers())


def _unlisted() -> dict[str, str]:
    return {"route": "unlisted"}


def _idempotency_store() -> FileIdempotencyStore:
    return FileIdempotencyStore(str(APP_DIRECTORY / IDEMPOTENCY_STORE_FILE))


def _deciders() -> dict[str, type[TasksDecider] | type[OverriddenRightDecider]]:
    return {name: OverriddenRightDecider if name == OVERRIDDEN_RIGHT else TasksDecider for name in DECIDED_NAMES}


def create_app() -> FastAPI:
    configure_suite_files(SuiteFiles(str(APP_DIRECTORY / CONTROL_STATE_FILE), str(APP_DIRECTORY / CREDENTIALS_FILE)))
    logging.getLogger().addHandler(SuiteLogHandler())

    variant = current_boot_variant()
    app = FastAPI()

    app.add_exception_handler(ScriptedReply, _scripted_reply)
    app.include_router(control_router)

    if serves_unlisted_route():
        app.add_api_route(UNLISTED_PATH, _unlisted, methods=["GET"])

    bind_tasks(
        app,
        handlers=TasksHandlerFactories(
            app=None if variant is BootVariant.MISSING_HANDLER else AppHandlers,
            channels=ChannelsHandlers,
            drafts=DraftsHandlers,
            hooks=HooksHandlers,
            preferences=PreferencesHandlers,
            tasks=TasksHandlers,
        ),
        authenticate={STRIPE_IDENTITY: StripeHook}
        if variant is BootVariant.MISSING_AUTHENTICATE_HOOK
        else {USER_IDENTITY: user_hook, STRIPE_IDENTITY: StripeHook},
        deciders={} if variant is BootVariant.MISSING_DECIDER else _deciders(),
        scope_resolvers={} if variant is BootVariant.MISSING_SCOPE_RESOLVER else {CHANNEL_SCOPE: ChannelResolver},
        idempotency_store=_idempotency_store,
        on_unexpected_error=TasksUnexpectedErrors,
    )
    bind_tasks_service(
        app,
        handlers=TasksServiceHandlerFactories(internal=InternalHandlers),
        authenticate={SERVICE_IDENTITY: service_hook},
        deciders={CALLER_SERVICE_RIGHT: ServiceDecider},
        on_unexpected_error=TasksUnexpectedErrors,
    )
    _bind_security_apis(app)

    return app


def _bind_security_apis(app: FastAPI) -> None:
    """The apis of the security cases: service writes, a device identity, optional auth and absolute URLs."""
    bind_tasks_service_writes(
        app,
        handlers=TasksServiceWritesHandlerFactories(internal_writes=InternalWritesHandlers),
        authenticate={SERVICE_IDENTITY: service_hook},
        deciders={CALLER_SERVICE_RIGHT: ServiceDecider},
        idempotency_store=_idempotency_store,
        on_unexpected_error=TasksUnexpectedErrors,
    )
    bind_tasks_devices(
        app,
        handlers=TasksDevicesHandlerFactories(devices=DevicesHandlers),
        authenticate={DEVICE_IDENTITY: DeviceHook},
        on_unexpected_error=TasksUnexpectedErrors,
    )
    bind_tasks_optional_auth(
        app,
        handlers=TasksOptionalAuthHandlerFactories(welcome=WelcomeHandlers),
        authenticate={USER_IDENTITY: user_hook},
        on_unexpected_error=TasksUnexpectedErrors,
    )
    bind_tasks_absolute_urls(
        app,
        handlers=TasksAbsoluteUrlsHandlerFactories(notes=NotesHandlers),
        authenticate={USER_IDENTITY: user_hook},
        on_unexpected_error=TasksUnexpectedErrors,
        public_origin=PUBLIC_ORIGIN,
    )


app = create_app()
