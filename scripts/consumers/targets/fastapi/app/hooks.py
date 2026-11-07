"""The `user` and `service` hook factories of the shared hook doubles: they read their bearer token through FastAPI
`Security` schemes (`OAuth2PasswordBearer`, `HTTPBearer`), as an app's own security layer does, and the hook decides."""

from typing import Annotated, Final

from fastapi import Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer, OAuth2PasswordBearer
from hook_doubles import ServiceHook, TokenUser, UserHook, user_id_of

from seampact.hooks import AuthenticateRequest

# Without a bearer token the scheme hands None to the factory, so a session-cookie caller still reaches the hook.
_USER_BEARER: Final = OAuth2PasswordBearer(tokenUrl="/token", auto_error=False)
_SERVICE_BEARER: Final = HTTPBearer(auto_error=False)


class BearerServiceHook(ServiceHook):
    """The `service` identity with the token the app's `HTTPBearer` read."""

    def __init__(self, token: str | None) -> None:
        self._token = token

    def service_token(self, request: AuthenticateRequest) -> str | None:
        return self._token


def user_hook(bearer: Annotated[str | None, Security(_USER_BEARER)]) -> UserHook:
    user_id = None if bearer is None else user_id_of(bearer)

    return UserHook(None if bearer is None or user_id is None else TokenUser(user_id, bearer))


def service_hook(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(_SERVICE_BEARER)],
) -> ServiceHook:
    return BearerServiceHook(None if credentials is None else credentials.credentials)
