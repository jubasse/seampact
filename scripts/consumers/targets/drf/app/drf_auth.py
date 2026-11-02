"""The consumer's own DRF token authentication, which `SEAMPACT["tasks"]["access"]` names for the `identity` access
kind: it signs in the caller of a bearer token of the suite's credentials and leaves any other request to the
`user` hook. The hook then reads the user DRF set, so the suite fails if a contract route skipped the class."""

from dataclasses import dataclass
from typing import Final

from rest_framework.authentication import BaseAuthentication
from rest_framework.request import Request
from seampact_consumer_suite.credentials import credential_text

_BEARER_PREFIX: Final = "bearer "
_BEARER_CHALLENGE: Final = "Bearer"


@dataclass(frozen=True, slots=True)
class TokenUser:
    user_id: str
    token: str
    is_authenticated: bool = True


def user_id_of(token: str) -> str | None:
    """The user id the suite's credentials give a token, None for an unknown one."""
    user_ids = {
        credential_text("userToken"): credential_text("userId"),
        credential_text("throttledUserToken"): credential_text("throttledUserId"),
    }

    return user_ids.get(token)


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
