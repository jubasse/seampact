"""The resolve-scope hook: a plain `def` or an `async def` method satisfies it."""

from collections.abc import Awaitable
from typing import Protocol

from seampact.hooks.resolve_scope_request import ResolveScopeRequest
from seampact.hooks.scope_resolution import ScopeResolution


class ResolveScopeHook(Protocol):
    def resolve_scope(self, request: ResolveScopeRequest) -> ScopeResolution | Awaitable[ScopeResolution]: ...
