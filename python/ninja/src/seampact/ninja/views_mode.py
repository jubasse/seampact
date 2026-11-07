"""The target option `views`, which the generator reads and the runtime runs; kept apart from the runtime so the
generator imports neither Django settings nor Ninja."""

from enum import StrEnum


class ViewsMode(StrEnum):
    """The target option `views`: plain views, or `async def` views Django runs natively under ASGI."""

    SYNC = "sync"
    ASYNC = "async"
