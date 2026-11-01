"""The decide hook, which answers each right and rule: a plain `def` or an `async def` method satisfies it."""

from collections.abc import Awaitable
from typing import Protocol

from seampact.hooks.decision import Decision
from seampact.hooks.requirement_request import RequirementRequest


class DecideHook(Protocol):
    def decide(self, request: RequirementRequest, /) -> Decision | Awaitable[Decision]: ...
