"""A request signed by a template scheme, for the verifier; its body and signatures never show in a repr."""

from dataclasses import dataclass
from typing import ClassVar

from seampact.hooks._redaction import RedactedRepr
from seampact.hooks.signature_template import SignatureTemplate


@dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class SignedTemplateRequest(RedactedRepr):
    """The decoded body bytes exactly as received, the signed timestamp text when the format has one, and every
    signature the header carries, still encoded."""

    _REDACTED_FIELDS: ClassVar[frozenset[str]] = frozenset({"raw_body", "candidate_signatures"})

    raw_body: bytes
    timestamp: str | None = None
    candidate_signatures: tuple[str, ...]
    key_id: str
    template: SignatureTemplate
