"""The binary's commands on an app config's OpenAPI documents (ADR 0010): `generate`, `generate --force`, which
overwrites a document edited by hand, and `check`."""

from enum import Enum


class DocumentsCommand(Enum):
    GENERATE = ("generate",)
    GENERATE_OVERWRITING_HAND_EDITS = ("generate", "--force")
    CHECK = ("check",)

    @property
    def arguments(self) -> list[str]:
        return list(self.value)
