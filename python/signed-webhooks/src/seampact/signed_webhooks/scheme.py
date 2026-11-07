"""A template signature scheme (ADR 0013): the MAC algorithm, the signed payload, the encoding and the tolerance."""

from dataclasses import dataclass
from enum import StrEnum

from seampact.signed_webhooks.placeholders import RAW_BODY_PLACEHOLDER, TIMESTAMP_PLACEHOLDER
from seampact.signed_webhooks.refusals import SignaturePayloadInvalidError, SignatureToleranceInvalidError


class SignatureEncoding(StrEnum):
    """How a signature scheme writes its MAC in the header."""

    HEX = "hex"
    BASE64 = "base64"


@dataclass(frozen=True, slots=True)
class SignatureScheme:
    """The scheme the application copies from the hook's signature template, tolerance included.

    Raises `SignaturePayloadInvalidError` when the payload does not hold `{rawBody}` exactly once and `{ts}` at most
    once, and `SignatureToleranceInvalidError` when the tolerance is missing for a `{ts}` payload, is not a whole
    number of milliseconds of at least 0, or is given for a payload with no `{ts}`.
    """

    algorithm: str
    payload: str
    encoding: SignatureEncoding
    tolerance_ms: int | None = None

    def __post_init__(self) -> None:
        # A plain "hex" or "base64" becomes the enum member; any other text raises the enum's ValueError.
        object.__setattr__(self, "encoding", SignatureEncoding(self.encoding))

        timestamp_count = self.payload.count(TIMESTAMP_PLACEHOLDER)

        if self.payload.count(RAW_BODY_PLACEHOLDER) != 1 or timestamp_count > 1:
            raise SignaturePayloadInvalidError(self.payload)

        _refuse_unfit_tolerance(self.payload, self.tolerance_ms, timestamp_count)

    @property
    def signs_timestamp(self) -> bool:
        return TIMESTAMP_PLACEHOLDER in self.payload


def _refuse_unfit_tolerance(payload: str, tolerance_ms: int | None, timestamp_count: int) -> None:
    if tolerance_ms is None:
        if timestamp_count == 1:
            raise SignatureToleranceInvalidError.missing(payload)

        return

    # A bool is an int in Python, and a float could be NaN: neither is a tolerance.
    if isinstance(tolerance_ms, bool) or not isinstance(tolerance_ms, int) or tolerance_ms < 0:
        raise SignatureToleranceInvalidError.not_whole_milliseconds(tolerance_ms)

    if timestamp_count == 0:
        raise SignatureToleranceInvalidError.without_timestamp(payload)
