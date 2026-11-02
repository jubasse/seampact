"""The FastAPI consumer of the http suite: the `tasks` api bound with the developer's handlers and the hook doubles,
less what the boot variant (`SEAMPACT_SUITE_BOOT_VARIANT`) leaves out, and the `tasksService` api of its relays,
beside the suite's control routes."""

import logging
from pathlib import Path
from typing import Final

from control import control_router
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from generated.tasks.fastapi import TasksHandlerFactories, bind_tasks
from generated.tasks_service.fastapi import TasksServiceHandlerFactories, bind_tasks_service
from handlers import (
    AppHandlers,
    ChannelsHandlers,
    DraftsHandlers,
    HooksHandlers,
    InternalHandlers,
    PreferencesHandlers,
    TasksHandlers,
)
from hook_doubles import (
    CALLER_SERVICE_RIGHT,
    OVERRIDDEN_RIGHT,
    ChannelResolver,
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

    return app


app = create_app()
