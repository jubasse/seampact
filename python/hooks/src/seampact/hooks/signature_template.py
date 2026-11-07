"""A template signature scheme of the IR (ADR 0013): algorithm, signed payload, encoding and tolerance."""

from dataclasses import dataclass

from seampact.hooks.signature_encoding import SignatureEncoding


@dataclass(frozen=True, slots=True, kw_only=True)
class SignatureTemplate:
    """`payload` holds the `{ts}` and `{rawBody}` placeholders; `tolerance_ms` is set when it holds `{ts}`."""

    algorithm: str
    payload: str
    encoding: SignatureEncoding
    tolerance_ms: int | None = None
