"""The verifier's answer: verified, or the failure that refused the request."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Self


class SignatureFailure(StrEnum):
    """Why a signature failed; the authenticate hook answers its declared 401 for each of them."""

    NO_SECRET = "no-secret"
    TIMESTAMP_MISSING = "timestamp-missing"
    TIMESTAMP_MALFORMED = "timestamp-malformed"
    TIMESTAMP_OUTSIDE_TOLERANCE = "timestamp-outside-tolerance"
    SIGNATURE_MISMATCH = "signature-mismatch"


@dataclass(frozen=True, slots=True)
class SignatureVerification:
    failure: SignatureFailure | None

    @classmethod
    def passed(cls) -> Self:
        return cls(None)

    @classmethod
    def failed(cls, failure: SignatureFailure) -> Self:
        return cls(failure)

    @property
    def verified(self) -> bool:
        return self.failure is None
