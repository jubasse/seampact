"""A request signed by a scheme the application verifies itself; its body, signature and headers never show."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar

from seampact.hooks._redaction import RedactedRepr


@dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class SignedApplicationRequest(RedactedRepr):
    """The decoded body bytes exactly as received, the signature header, and the headers the scheme declares."""

    _REDACTED_FIELDS: ClassVar[frozenset[str]] = frozenset({"raw_body", "signature_header", "headers"})

    raw_body: bytes
    signature_header: str
    headers: Mapping[str, str]
    key_id: str | None = None
