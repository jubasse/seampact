"""The throttle bucket a requirement counts against."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True, kw_only=True)
class ThrottleBucket:
    """`key` is a fixed-size digest of the key values; `values` are the values of the key sources in order."""

    id: str
    key: str
    values: tuple[object, ...]
    limit: int | None = None
    window_ms: int | None = None
