"""A template scheme's signature header parsed by its format (ADR 0013 "Test vectors"), as every target parses it:
comma-separated `name=value` pairs (`t={ts},v1={sig}`), each slot read from its pair and a repeated signature pair
adding a candidate, or a literal prefix before `{sig}` (`sha256={sig}`)."""

import re
from dataclasses import dataclass
from typing import ClassVar, Final

from seampact.hooks._redaction import RedactedRepr

_TIMESTAMP_SLOT: Final = "{ts}"
_SIGNATURE_SLOT: Final = "{sig}"
_DIGITS: Final = re.compile(r"[0-9]+")
_PAIR_FORMAT: Final = re.compile(r"[A-Za-z0-9_-]+=\{(ts|sig)\}(,[A-Za-z0-9_-]+=\{(ts|sig)\})*")


@dataclass(frozen=True, slots=True, repr=False)
class SignatureHeader(RedactedRepr):
    """The signed timestamp text when the format has one, and every signature the header carries, still encoded."""

    _REDACTED_FIELDS: ClassVar[frozenset[str]] = frozenset({"candidate_signatures"})

    timestamp: str | None
    candidate_signatures: tuple[str, ...]


def parsed_signature_header(format_: str, header: str | None) -> SignatureHeader | None:
    """None for a missing or malformed header: no signature, a timestamp that is not digits, a repeated timestamp,
    or a pair that is not `name=value`."""
    if header is None or header.strip() == "":
        return None

    if _PAIR_FORMAT.fullmatch(format_) is None:
        return _prefixed(format_, header)

    timestamp_name: str | None = None
    signature_name: str | None = None

    for pair in format_.split(","):
        name, _, slot = pair.partition("=")

        if slot == _TIMESTAMP_SLOT:
            timestamp_name = name
        elif slot == _SIGNATURE_SLOT:
            signature_name = name

    if signature_name is None:
        return None

    return _pairs(header, timestamp_name, signature_name)


def _pairs(header: str, timestamp_name: str | None, signature_name: str) -> SignatureHeader | None:
    timestamp: str | None = None
    candidates: list[str] = []

    for pair in header.split(","):
        separator = pair.find("=")

        if separator <= 0:
            return None

        name = pair[:separator].strip()
        value = pair[separator + 1 :].strip()

        if name == timestamp_name:
            if timestamp is not None or _DIGITS.fullmatch(value) is None:
                return None

            timestamp = value
        elif name == signature_name:
            if value == "":
                return None

            candidates.append(value)

    if not candidates or (timestamp_name is not None and timestamp is None):
        return None

    return SignatureHeader(timestamp, tuple(candidates))


def _prefixed(format_: str, header: str) -> SignatureHeader | None:
    if not format_.endswith(_SIGNATURE_SLOT):
        return None

    prefix = format_[: -len(_SIGNATURE_SLOT)]

    if not header.startswith(prefix) or len(header) == len(prefix):
        return None

    return SignatureHeader(None, (header[len(prefix) :],))
