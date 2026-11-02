"""The CSRF failure of DRF's `SessionAuthentication` on a contract route (ADR 0027 "Exceptions"): DRF checks CSRF only
for a caller its session authenticated, and raises a `PermissionDenied`. The contract views wrap `enforce_csrf` of each
`SessionAuthentication` they build, so that failure, and no other `PermissionDenied` raised during authentication,
answers the `csrfInvalid` role."""

from rest_framework.authentication import BaseAuthentication, SessionAuthentication
from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request

_ENFORCE_CSRF = "enforce_csrf"


class CsrfRefusal(PermissionDenied):
    """The CSRF failure of a `SessionAuthentication`."""


def csrf_tagged[A: BaseAuthentication](authenticator: A) -> A:
    """The authenticator, its CSRF failure raised as `CsrfRefusal` when it is a `SessionAuthentication`."""
    if not isinstance(authenticator, SessionAuthentication):
        return authenticator

    enforce = authenticator.enforce_csrf

    def tagged_enforce_csrf(request: Request) -> None:
        try:
            enforce(request)
        except PermissionDenied as refused:
            raise CsrfRefusal(refused.detail) from refused

    setattr(authenticator, _ENFORCE_CSRF, tagged_enforce_csrf)

    return authenticator
