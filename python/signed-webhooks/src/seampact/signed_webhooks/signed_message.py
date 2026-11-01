"""What a template-signed request carries: the raw body and the signature header's timestamp and candidates.

Its `repr` never shows the body or a signature, so a log line, a debugger or an error tracker that captures frame
locals sees no sensitive byte.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Final

REDACTED: Final = "[redacted]"


@dataclass(frozen=True, slots=True, repr=False)
class SignedMessage:
    """The decoded body bytes exactly as received, the signed timestamp text as received when the header carries one,
    and every signature the header carries, still encoded."""

    raw_body: bytes
    timestamp: str | None
    candidate_signatures: tuple[str, ...]

    def __repr__(self) -> str:
        return f"SignedMessage(raw_body={REDACTED}, timestamp={self.timestamp!r}, candidate_signatures={REDACTED})"

    def __rich_repr__(self) -> Iterator[tuple[str, object]]:
        yield "raw_body", REDACTED
        yield "timestamp", self.timestamp
        yield "candidate_signatures", REDACTED
