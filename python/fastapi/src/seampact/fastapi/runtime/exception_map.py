"""The exception map `bind_<api>()` registers (ADR 0026 "Exceptions on contract routes"): a handler for the api's
contract exception base, one for the boundary's refusals raised by its dependencies and one for a replayed idempotent
reply, each rendering on a contract request of its own api and raising again elsewhere; and a wrapper around every app
handler that can take an `HTTPException` (Starlette's or FastAPI's class, a subclass, a status code), which records
the exception in the request scope before the app's handler renders it, so the boundary answers with its role."""

from collections.abc import Awaitable, Callable
from typing import Final

import fastapi
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from seampact.codegen.runtime.failures import ContractRefusal
from seampact.codegen.runtime.replies import Reply, error_reply
from seampact.fastapi.runtime.api_binding import ApiBinding
from seampact.fastapi.runtime.handler_reply import code_reply
from seampact.fastapi.runtime.input_features import ReplayedReply
from seampact.fastapi.runtime.request_state import scope_states, state_of

type ExceptionHandler = Callable[[Request, Exception], Response | Awaitable[Response]]

_WRAPPED: Final = "__seampact_wrapped__"


def register_exception_map(binding: ApiBinding) -> None:
    app = binding.app
    app.add_exception_handler(ContractRefusal, _render_refusal)
    app.add_exception_handler(ReplayedReply, _render_replay)
    app.add_exception_handler(binding.placement.error_base, _contract_error_handler(binding))
    app.exception_handlers.setdefault(HTTPException, http_exception_handler)

    for key, handler in list(app.exception_handlers.items()):
        if takes_http_exception(key) and not is_wrapped(handler):
            app.exception_handlers[key] = _recording(handler)


def takes_http_exception(key: object) -> bool:
    """A status code, or Starlette's `HTTPException` class or a subclass (FastAPI's derives from it)."""
    if isinstance(key, int):
        return True

    return isinstance(key, type) and issubclass(key, HTTPException)


def is_wrapped(handler: object) -> bool:
    return getattr(handler, _WRAPPED, False) is True


def _recording(handler: ExceptionHandler) -> ExceptionHandler:
    async def recording(request: Request, exception: Exception) -> Response:
        if isinstance(exception, HTTPException):
            for state in scope_states(request.scope).values():
                state.http_exception = exception

        response = handler(request, exception)

        return await response if isinstance(response, Awaitable) else response

    setattr(recording, _WRAPPED, True)

    return recording


async def _render_refusal(request: Request, exception: Exception) -> Response:
    if not isinstance(exception, ContractRefusal):
        raise exception

    state = state_of(request.scope, exception.api)

    if state is None:
        raise exception

    reply = error_reply(state.contract, state.operation_id, exception.code, exception.params)

    return _response(state.authored.author(reply))


async def _render_replay(request: Request, exception: Exception) -> Response:
    """The stored reply of an idempotent request, written as stored, so the handler never runs again."""
    if not isinstance(exception, ReplayedReply):
        raise exception

    state = state_of(request.scope, exception.api)

    if state is None:
        raise exception

    return _response(state.authored.author(exception.reply))


def _contract_error_handler(binding: ApiBinding) -> ExceptionHandler:
    async def render(request: Request, exception: Exception) -> Response:
        state = state_of(request.scope, binding.api)

        if state is None or not isinstance(exception, binding.placement.error_base):
            raise exception

        reply = code_reply(
            state.contract, state.operation_id, getattr(exception, "CODE", ""), getattr(exception, "params", None)
        )

        return _response(state.authored.author(reply))

    return render


def _response(reply: Reply) -> Response:
    return fastapi.Response(content=reply.body, status_code=reply.status, headers=dict(reply.headers))
