"""The FastAPI consumer of the http suite: the `tasks` api bound with the developer's handlers and the hook doubles,
less what the boot variant (`SEAMPACT_SUITE_BOOT_VARIANT`) leaves out, beside the suite's control routes."""

import logging
from pathlib import Path
from typing import Final

from control import control_router
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from generated.tasks.fastapi import TasksHandlerFactories, bind_tasks
from handlers import AppHandlers, ChannelsHandlers, DraftsHandlers
from hooks import ChannelResolver, TasksUnexpectedErrors, UserHook
from seampact_consumer_suite.boot_variant import BootVariant, current_boot_variant, serves_unlisted_route
from seampact_consumer_suite.log_lines import SuiteLogHandler
from seampact_consumer_suite.scripted_answers import ScriptedReply
from seampact_consumer_suite.suite_files import SuiteFiles, configure_suite_files

APP_DIRECTORY: Final = Path(__file__).parent
CONTROL_STATE_FILE: Final = "suite-control.json"
CREDENTIALS_FILE: Final = "credentials.json"
UNLISTED_PATH: Final = "/v1/unlisted"
USER_IDENTITY: Final = "user"
CHANNEL_SCOPE: Final = "channel"


async def _scripted_reply(_request: Request, failure: Exception) -> JSONResponse:
    if not isinstance(failure, ScriptedReply):
        raise failure

    return JSONResponse(failure.body(), status_code=failure.status, headers=failure.headers())


def _unlisted() -> dict[str, str]:
    return {"route": "unlisted"}


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
        ),
        authenticate={} if variant is BootVariant.MISSING_AUTHENTICATE_HOOK else {USER_IDENTITY: UserHook},
        scope_resolvers={} if variant is BootVariant.MISSING_SCOPE_RESOLVER else {CHANNEL_SCOPE: ChannelResolver},
        on_unexpected_error=TasksUnexpectedErrors,
    )

    return app


app = create_app()
