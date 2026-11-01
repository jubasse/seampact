"""The store of idempotent requests: plain `def` or `async def` methods satisfy it."""

from collections.abc import Awaitable
from typing import Protocol

from seampact.hooks.idempotency_begin import IdempotencyBegin
from seampact.hooks.idempotency_claim import IdempotencyClaim
from seampact.hooks.stored_response import StoredResponse


class IdempotencyStore(Protocol):
    def begin(self, claim: IdempotencyClaim, /) -> IdempotencyBegin | Awaitable[IdempotencyBegin]:
        """Claims the key: started for a new key, or running, mismatch or replay for a known one."""
        ...

    def complete(self, key: str, response: StoredResponse, /) -> Awaitable[None] | None:
        """Keeps the response for the key's replays."""
        ...

    def abandon(self, key: str, /) -> Awaitable[None] | None:
        """Releases the key of a request that failed, so a retry starts again."""
        ...
