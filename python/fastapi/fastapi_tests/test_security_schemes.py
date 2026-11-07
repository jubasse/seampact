"""Authenticate hooks on FastAPI `Security` schemes (ADR 0026 "Native security layers"): the hook factory depends on
the app's `HTTPBearer` or `OAuth2PasswordBearer`, FastAPI reads the credential and the hook decides; the 401 a
scheme raises answers the contract's `unauthenticated` in the api's format."""

from typing import Annotated, Final

import fastapi
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer, OAuth2PasswordBearer
from fastapi.testclient import TestClient

from seampact.hooks import (
    AuthenticateHook,
    AuthenticateRequest,
    AuthenticateResult,
    ErrorCodeWithParams,
    authenticate_result,
)

from .golden_app import AdmittedUser, served

_VALID_TOKEN: Final = "valid-token"
_UNAUTHENTICATED: Final = "api.unauthenticated"
_LIST_CHANNELS: Final = "/v1/channels"
_PROBLEM_JSON: Final = "application/problem+json"

_bearer = HTTPBearer()
_password_bearer = OAuth2PasswordBearer(tokenUrl="token")


class _TokenUser:
    """Admits the one valid token the scheme read; any other is the contract's `unauthenticated`."""

    def __init__(self, token: str) -> None:
        self.token = token

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        if self.token != _VALID_TOKEN:
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=_UNAUTHENTICATED))

        return AdmittedUser().authenticate(request)


def _http_bearer_user(
    credentials: Annotated[HTTPAuthorizationCredentials, fastapi.Security(_bearer)],
) -> AuthenticateHook:
    return _TokenUser(credentials.credentials)


def _password_bearer_user(token: Annotated[str, fastapi.Security(_password_bearer)]) -> AuthenticateHook:
    return _TokenUser(token)


def _list_channels(client: TestClient, authorization: str | None) -> tuple[int, str, str]:
    headers = {} if authorization is None else {"Authorization": authorization}
    response = client.get(_LIST_CHANNELS, headers=headers)

    return response.status_code, response.headers.get("content-type", ""), response.text


def test_an_http_bearer_scheme_hands_its_token_to_the_hook() -> None:
    client = TestClient(served(_http_bearer_user))

    status, _, _ = _list_channels(client, f"Bearer {_VALID_TOKEN}")

    assert status == 200


def test_the_hook_denies_a_token_the_http_bearer_scheme_read() -> None:
    client = TestClient(served(_http_bearer_user))

    status, media, body = _list_channels(client, "Bearer another-token")

    assert (status, media) == (401, _PROBLEM_JSON)
    assert _UNAUTHENTICATED in body


def test_the_http_bearer_schemes_401_for_a_missing_credential_answers_unauthenticated() -> None:
    client = TestClient(served(_http_bearer_user))

    status, media, body = _list_channels(client, None)

    assert (status, media) == (401, _PROBLEM_JSON)
    assert _UNAUTHENTICATED in body


def test_an_oauth2_password_bearer_scheme_hands_its_token_to_the_hook() -> None:
    client = TestClient(served(_password_bearer_user))

    assert _list_channels(client, f"Bearer {_VALID_TOKEN}")[0] == 200


def test_the_oauth2_password_bearer_schemes_401_answers_unauthenticated() -> None:
    client = TestClient(served(_password_bearer_user))

    status, media, body = _list_channels(client, None)

    assert (status, media) == (401, _PROBLEM_JSON)
    assert _UNAUTHENTICATED in body
