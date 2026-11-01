"""A scope resolved for the request: its name, its id and, when loaded, its value."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True, kw_only=True)
class ResolvedScope:
    scope: str
    id: object
    value: object | None = None
