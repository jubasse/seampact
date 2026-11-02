"""The listener the boundary calls for each failure it answers with the api's 500: a plain `def` or an `async def`
satisfies it."""

from collections.abc import Awaitable
from typing import Protocol

from seampact.hooks.unexpected_failure import UnexpectedFailure


class UnexpectedErrorListener(Protocol):
    def on_unexpected_error(self, failure: UnexpectedFailure, /) -> Awaitable[None] | None:
        """Hears of the failure, to report it; the reply is the api's 500 whatever it does."""
        ...
