"""The suite's control routes (ADR 0015 "Control routes") on FastAPI, outside the api's base path."""

from fastapi import APIRouter, Request, Response
from seampact_consumer_suite.control_routes import (
    HOOK_CALLS_PATH,
    LOG_LINES_PATH,
    SCRIPT_PATH,
    ControlReply,
    hook_calls_reply,
    log_lines_reply,
    script_reply,
)

control_router = APIRouter(include_in_schema=False)


def _response(reply: ControlReply) -> Response:
    return Response(reply.body, status_code=reply.status, media_type=reply.content_type)


@control_router.put(SCRIPT_PATH)
async def load_script(request: Request) -> Response:
    return _response(script_reply(await request.body()))


@control_router.get(HOOK_CALLS_PATH)
def hook_calls() -> Response:
    return _response(hook_calls_reply())


@control_router.get(LOG_LINES_PATH)
def log_lines() -> Response:
    return _response(log_lines_reply())
