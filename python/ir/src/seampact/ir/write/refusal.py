"""Why the writer refuses a write: the codes of the Node writer (`codegen-core`), a message and its fix."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class WriterRefusal:
    code: str
    message: str
    fix: str
