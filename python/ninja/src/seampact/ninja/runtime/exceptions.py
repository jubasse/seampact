"""Ninja's exceptions on a contract route (ADR 0027 "Ninja", "Exceptions"): the app's `NinjaAPI.on_exception`, which
Ninja calls for every exception it handles (`auth=` failures and throttles included), wrapped so the exception is
recorded for the boundary before the app's handler renders it; and the role the boundary answers it with. Outside
`DEBUG`, an exception the app's handler re-raises on a request a boundary matched gets a bare 500 the boundary replaces
with the api's own, logging its class and place only: Django would log its message on `django.request`."""

import math
from collections.abc import Callable
from http import HTTPStatus
from typing import Final

from django.conf import settings
from django.core.exceptions import BadRequest, SuspiciousOperation
from django.http import HttpRequest, HttpResponse
from ninja import NinjaAPI
from ninja.errors import AuthenticationError, AuthorizationError, HttpError, Throttled

from seampact.codegen.runtime.access_steps import UNAUTHENTICATED_ROLE
from seampact.codegen.runtime.contract import ROLE_OF_STATUS
from seampact.django.runtime import RecordedRole
from seampact.django.runtime.request_state import matched_by_a_boundary, record_exception

ON_EXCEPTION_MARK: Final = "seampact_records"
_FORBIDDEN_ROLE: Final = "forbidden"
RATE_LIMITED_ROLE: Final = "rateLimited"
_RETRY_AFTER_SLOT: Final = "retryAfterMs"
_MILLISECONDS_PER_SECOND: Final = 1000


def recording_on_exception(api: NinjaAPI) -> Callable[..., object]:
    """Wraps the app's `on_exception` once; the wrapper records the exception, then calls the app's."""
    current: Callable[[HttpRequest, Exception], object] = api.on_exception

    if getattr(current, ON_EXCEPTION_MARK, False):
        return current

    def recording(request: HttpRequest, exception: Exception) -> object:
        record_exception(request, exception)

        try:
            return current(request, exception)
        except Exception as raised:
            if raised is not exception or not _boundary_answers(request, exception):
                raise

            return HttpResponse(status=HTTPStatus.INTERNAL_SERVER_ERROR)

    setattr(recording, ON_EXCEPTION_MARK, True)
    # Ninja calls `self.api.on_exception`: an instance attribute takes the method's place.
    setattr(api, "on_exception", recording)  # noqa: B010

    return recording


def _boundary_answers(request: HttpRequest, exception: Exception) -> bool:
    """The boundary that matched the request replaces any reply after this exception with the api's 500; Django keeps
    its own answer to a bad request, and under `DEBUG` or `DEBUG_PROPAGATE_EXCEPTIONS` its page or the exception."""
    if settings.DEBUG or settings.DEBUG_PROPAGATE_EXCEPTIONS or isinstance(exception, BadRequest | SuspiciousOperation):
        return False

    return matched_by_a_boundary(request)


def ninja_role(recorded: BaseException) -> RecordedRole | None:
    """The role of Ninja's own HTTP errors; None for any other exception."""
    if isinstance(recorded, AuthenticationError):
        return RecordedRole(UNAUTHENTICATED_ROLE, recorded.status_code)

    if isinstance(recorded, AuthorizationError):
        return RecordedRole(_FORBIDDEN_ROLE, recorded.status_code)

    if isinstance(recorded, Throttled):
        slots = (
            {} if recorded.wait is None else {_RETRY_AFTER_SLOT: math.ceil(recorded.wait * _MILLISECONDS_PER_SECOND)}
        )
        return RecordedRole(RATE_LIMITED_ROLE, recorded.status_code, slots)

    if isinstance(recorded, HttpError):
        role = ROLE_OF_STATUS.get(recorded.status_code)
        return None if role is None else RecordedRole(role, recorded.status_code)

    return None
