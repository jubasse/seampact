"""The operation a hook call is about: its api and its operation id."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True, kw_only=True)
class OperationRef:
    api: str
    id: str
