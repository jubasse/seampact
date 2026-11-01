"""The clock the timestamp tolerance is checked against: the system clock, or a fixed one in a test."""

import time
from typing import Final, Protocol

_NANOSECONDS_PER_MILLISECOND: Final = 1_000_000


class Clock(Protocol):
    def now_milliseconds(self) -> int:
        """Milliseconds since the Unix epoch."""
        ...


class SystemClock:
    """The system clock."""

    def now_milliseconds(self) -> int:
        return time.time_ns() // _NANOSECONDS_PER_MILLISECOND
