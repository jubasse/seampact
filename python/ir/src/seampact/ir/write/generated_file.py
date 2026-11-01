"""One file a target generated: a relative POSIX `path` inside its output root and its text."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class GeneratedFile:
    path: str
    contents: str
