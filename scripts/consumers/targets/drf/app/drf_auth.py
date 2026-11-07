"""The consumer's own DRF token authentication, which `SEAMPACT["tasks"]["access"]` names for the `identity` access
kind: it signs in the caller of a bearer token of the suite's credentials and leaves any other request to the
`user` hook. The hook then reads the user DRF set, so the suite fails if a contract route skipped the class."""

from typing import Final

from hook_doubles import TokenUser, user_id_of
from rest_framework.authentication import BaseAuthentication
from rest_framework.request import Request

_BEARER_PREFIX: Final = "bearer "
_BEARER_CHALLENGE: Final = "Bearer"


class SuiteTokenAuthentication(BaseAuthentication):
    def authenticate(self, request: Request) -> tuple[TokenUser, str] | None:
        header = request.headers.get("Authorization", "")

        # The token as the contract's bearer scheme reads it: a case-insensitive scheme, then the trimmed token.
        if not header.lower().startswith(_BEARER_PREFIX):
            return None

        token = header[len(_BEARER_PREFIX) :].strip()
        user_id = user_id_of(token)

        return None if user_id is None else (TokenUser(user_id, token), token)

    def authenticate_header(self, request: Request) -> str:
        return _BEARER_CHALLENGE
