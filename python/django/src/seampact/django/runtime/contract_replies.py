"""The replies the Django layer writes on a contract request: a runtime `Reply` as a Django `HttpResponse`, recorded
as the boundary's own; the answer to a role by ADR 0023's rule; and the api's 500, logged to the `seampact.<api>`
logger with the unexpected-error listener told."""

import logging
from collections.abc import Mapping
from typing import Final

from django.conf import settings
from django.http import HttpRequest, HttpResponse

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal, failure_place
from seampact.codegen.runtime.replies import Reply, error_reply, internal_error_reply, role_params
from seampact.codegen.runtime.sync_driver import call_without_suspension, run_without_suspension
from seampact.django.runtime.api_settings import SettingsError, unexpected_error_listener
from seampact.django.runtime.request_state import state_of
from seampact.hooks import UnexpectedFailure

_LOGGER_PREFIX: Final = "seampact."


def logger(api: str) -> logging.Logger:
    return logging.getLogger(_LOGGER_PREFIX + api)


def django_response(request: HttpRequest, contract: ApiContract, reply: Reply) -> HttpResponse:
    """The reply as an `HttpResponse`, recorded in the request's holder so the outgoing check knows it."""
    state = state_of(request, contract.api)

    if state is not None:
        state.authored.author(reply)

    response = HttpResponse(reply.body, status=reply.status)

    for name, value in reply.headers:
        response[name] = value

    return response


def refusal_response(
    request: HttpRequest, contract: ApiContract, operation_id: str, refused: ContractRefusal
) -> HttpResponse:
    return django_response(request, contract, error_reply(contract, operation_id, refused.code, refused.params))


def role_answer(
    contract: ApiContract, operation_id: str, role: str, status: int, slots: Mapping[str, object] | None = None
) -> Reply | None:
    """The code of the role the operation declares, else its single code of that status, with the params its role
    binding renders from `slots`; None when it has neither."""
    code = contract.role_code(operation_id, role)

    if code is None:
        codes = contract.declared_codes(operation_id, status)
        code = codes[0] if len(codes) == 1 else None

    if code is None:
        return None

    return error_reply(contract, operation_id, code, role_params(contract, operation_id, code, role, slots or {}))


def unexpected_response(
    request: HttpRequest, contract: ApiContract, operation_id: str | None, context: str, cause: BaseException | None
) -> HttpResponse:
    """The api's 500, after the log line and the unexpected-error listener."""
    report_unexpected(request, contract, operation_id, context, cause)

    return django_response(request, contract, internal_error_reply(contract, operation_id))


def report_unexpected(
    request: HttpRequest, contract: ApiContract, operation_id: str | None, context: str, cause: BaseException | None
) -> None:
    """Logs the failure and tells the listener; a listener that fails is logged too, and the reply stays the 500. The
    reason names the cause's class and place; its message and traceback may carry an input value, so they reach the
    log and the listener under `DEBUG` only."""
    reason = context if cause is None else f"{context}: {_cause_text(cause)}"
    api_logger = logger(contract.api)
    api_logger.error("seampact: %s (operation %s)", reason, operation_id, exc_info=cause if settings.DEBUG else None)

    try:
        listener = unexpected_error_listener(contract.api, request)

        if listener is not None:
            failure = UnexpectedFailure(api=contract.api, operation=operation_id, reason=reason, cause=cause)
            run_without_suspension(call_without_suspension(listener, failure))
    except (SettingsError, Exception):
        api_logger.exception("seampact: the unexpected-error listener of api '%s' failed", contract.api)


def _cause_text(cause: BaseException) -> str:
    place = failure_place(cause)

    if settings.DEBUG and not isinstance(cause, BoundaryFailureError):
        return f"{place}: {cause}"

    return place
