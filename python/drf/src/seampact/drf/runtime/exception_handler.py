"""The exception handler of the contract views (ADR 0027 "DRF", "Exceptions"): each view returns its api's handler
from `get_exception_handler()`, so the app's `EXCEPTION_HANDLER` never applies to a contract route. It marks the
transaction for rollback, writes an idempotent request's replayed reply, renders a contract exception, answers DRF's
and Django's exceptions with their role (the CSRF failure of `SessionAuthentication` as `csrfInvalid`), and answers
any other exception with the api's 500, logged, the unexpected-error listener told."""

import math
from collections.abc import Callable, Mapping
from typing import Final

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404, HttpRequest, HttpResponseBase
from rest_framework import exceptions
from rest_framework.request import Request
from rest_framework.views import set_rollback

from seampact.codegen.runtime.access_steps import CSRF_INVALID_ROLE, UNAUTHENTICATED_ROLE
from seampact.codegen.runtime.contract import NOT_FOUND_ROLE, ROLE_OF_STATUS, ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.django.runtime.contract_replies import django_response, role_answer, unexpected_response
from seampact.django.runtime.idempotency_records import ReplayedReplyError
from seampact.django.runtime.request_state import state_of
from seampact.drf.runtime.admission import contract_error_reply
from seampact.drf.runtime.session_csrf import CsrfRefusal

type ExceptionHandler = Callable[[Exception, Mapping[str, object]], HttpResponseBase | None]

_UNAUTHENTICATED: Final = (UNAUTHENTICATED_ROLE, 401)
_CSRF_INVALID: Final = (CSRF_INVALID_ROLE, 403)
_FORBIDDEN: Final = ("forbidden", 403)
_NOT_FOUND: Final = (NOT_FOUND_ROLE, 404)
_RATE_LIMITED: Final = ("rateLimited", 429)
_MILLISECONDS_PER_SECOND: Final = 1000
_CROSSED_VIEW: Final = "an exception crossed the view"


def contract_exception_reply(api: str, exception: Exception, context: Mapping[str, object]) -> HttpResponseBase | None:
    """The contract reply for an exception a contract view raised."""
    view = context.get("view")
    contract = getattr(view, "contract", None)
    drf_request = context.get("request")
    request = drf_request._request if isinstance(drf_request, Request) else drf_request

    if not isinstance(contract, ApiContract) or not isinstance(request, HttpRequest):
        raise BoundaryFailureError(f"seampact: the exception handler of api '{api}' ran outside a contract view.")

    set_rollback()
    state = state_of(request, api)

    if state is None or isinstance(exception, BoundaryFailureError):
        operation_id = None if state is None else state.operation_id
        return unexpected_response(request, contract, operation_id, _CROSSED_VIEW, exception)

    operation_id = state.operation_id

    if isinstance(exception, ReplayedReplyError):
        return django_response(request, contract, exception.replayed.reply)

    try:
        if isinstance(exception, ContractRefusal) or _is_contract_error(contract, operation_id, exception):
            return django_response(request, contract, contract_error_reply(contract, operation_id, exception))

        role = _role(exception)
    except BoundaryFailureError as failure:
        reason = f"the exception could not be answered: {failure}"
        return unexpected_response(request, contract, operation_id, reason, exception)

    if role is None:
        return unexpected_response(request, contract, operation_id, _CROSSED_VIEW, exception)

    reply = role_answer(contract, operation_id, role[0], role[1], _slots(exception))

    if reply is None:
        reason = f"the operation declares no code for the role '{role[0]}' nor a single code of status {role[1]}"
        return unexpected_response(request, contract, operation_id, reason, exception)

    return django_response(request, contract, reply)


def _is_contract_error(contract: ApiContract, operation_id: str, exception: Exception) -> bool:
    code = getattr(type(exception), "code", None)

    return (
        not isinstance(exception, exceptions.APIException)
        and isinstance(code, str)
        and contract.declares(operation_id, code)
    )


def _role(exception: Exception) -> tuple[str, int] | None:
    if isinstance(exception, exceptions.NotAuthenticated | exceptions.AuthenticationFailed):
        return _UNAUTHENTICATED

    if isinstance(exception, CsrfRefusal):
        return _CSRF_INVALID

    if isinstance(exception, exceptions.PermissionDenied | DjangoPermissionDenied):
        return _FORBIDDEN

    if isinstance(exception, exceptions.NotFound | Http404):
        return _NOT_FOUND

    if isinstance(exception, exceptions.Throttled):
        return _RATE_LIMITED

    if isinstance(exception, exceptions.APIException):
        status = exception.status_code
        return (ROLE_OF_STATUS.get(status, ""), status)

    return None


def _slots(exception: Exception) -> dict[str, object]:
    wait = getattr(exception, "wait", None) if isinstance(exception, exceptions.Throttled) else None

    if not isinstance(wait, int | float):
        return {}

    return {"retryAfterMs": math.ceil(wait * _MILLISECONDS_PER_SECOND)}
