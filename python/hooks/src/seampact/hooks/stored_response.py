"""The response an idempotency store keeps for a replay; its body and header values never show in a repr."""

from dataclasses import dataclass
from typing import ClassVar

from seampact.hooks._redaction import RedactedRepr


@dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class StoredResponse(RedactedRepr):
    _REDACTED_FIELDS: ClassVar[frozenset[str]] = frozenset({"body"})

    @dataclass(frozen=True, slots=True, kw_only=True, repr=False)
    class Header(RedactedRepr):
        _REDACTED_FIELDS: ClassVar[frozenset[str]] = frozenset({"value"})

        name: str
        value: str

    status: int
    headers: tuple[Header, ...]
    body: bytes
