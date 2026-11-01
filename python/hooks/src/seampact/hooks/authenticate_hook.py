"""The authenticate hook: a plain `def` or an `async def` method satisfies it."""

from collections.abc import Awaitable
from typing import Protocol

from seampact.hooks.authenticate_request import AuthenticateRequest
from seampact.hooks.authenticate_result import AuthenticateResult


class AuthenticateHook(Protocol):
    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult | Awaitable[AuthenticateResult]: ...
