"""The subject a requirement is checked against: its type, its id and, when loaded, its record."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True, kw_only=True)
class SubjectRef:
    type: str
    id: object
    record: object | None = None
