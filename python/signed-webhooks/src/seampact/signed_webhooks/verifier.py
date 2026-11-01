"""Verifies a template-signed request (ADR 0013 "Where the verification happens").

Rebuilds the signed payload from the raw bytes, computes the MAC with each valid secret, compares it in constant time
with each candidate, then checks the timestamp against the tolerance in both directions.
"""

import base64
import hashlib
import hmac
import re
from collections.abc import Sequence
from typing import Final

from seampact.signed_webhooks.clock import Clock, SystemClock
from seampact.signed_webhooks.placeholders import RAW_BODY_PLACEHOLDER, SUPPORTED_ALGORITHM, TIMESTAMP_PLACEHOLDER
from seampact.signed_webhooks.refusals import EmptySignatureSecretError, UnsupportedSignatureAlgorithmError
from seampact.signed_webhooks.scheme import SignatureEncoding, SignatureScheme
from seampact.signed_webhooks.secret_lookup import SecretLookup
from seampact.signed_webhooks.signed_message import REDACTED, SignedMessage
from seampact.signed_webhooks.verification import SignatureFailure, SignatureVerification

_HMAC_SHA256_BYTES: Final = 32
_MILLISECONDS_PER_SECOND: Final = 1000
# Longer than any Unix time in seconds for millions of years; beyond it the timestamp is outside every tolerance,
# and `int()` of a very long text would raise.
_MAX_TIMESTAMP_DIGITS: Final = 20
_UNIX_SECONDS: Final = re.compile(r"[0-9]+")
_HEX: Final = re.compile(r"(?:[0-9a-fA-F]{2})+")
_BASE64: Final = re.compile(r"(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?")


class _LookedUpSecrets:
    """The secrets of one verification, held so that a frame capturing them shows no secret."""

    __slots__ = ("_secrets",)

    def __init__(self, secrets: Sequence[str | bytes]) -> None:
        self._secrets = tuple(secrets)

    def __repr__(self) -> str:
        return REDACTED

    def is_empty(self) -> bool:
        return len(self._secrets) == 0

    # Every secret is checked before any is kept or hashed: a frame captured at the refusal holds only the refused
    # value, never the usable secrets around it.
    def usable(self, key_id: str) -> tuple[bytes, ...]:
        for index, secret in enumerate(self._secrets):
            if not _is_usable_secret(secret):
                raise EmptySignatureSecretError(key_id, index)

        return tuple(secret.encode("utf-8") if isinstance(secret, str) else secret for secret in self._secrets)


def _is_usable_secret(secret: object) -> bool:
    return isinstance(secret, str | bytes) and len(secret) > 0


class TemplateSignatureVerifier:
    """Verifies template-signed requests with the application's secrets; the clock is injectable for tests."""

    __slots__ = ("_clock", "_secret_lookup")

    def __init__(self, secret_lookup: SecretLookup, clock: Clock | None = None) -> None:
        self._secret_lookup = secret_lookup
        self._clock: Clock = SystemClock() if clock is None else clock

    def verify(self, message: SignedMessage, key_id: str, scheme: SignatureScheme) -> SignatureVerification:
        """Raises `UnsupportedSignatureAlgorithmError` for another algorithm than hmac-sha256, and
        `EmptySignatureSecretError` when the lookup returns an empty secret or one that is neither text nor bytes."""
        if scheme.algorithm != SUPPORTED_ALGORITHM:
            raise UnsupportedSignatureAlgorithmError(scheme.algorithm)

        if scheme.signs_timestamp and message.timestamp is None:
            return SignatureVerification.failed(SignatureFailure.TIMESTAMP_MISSING)

        secrets = _LookedUpSecrets(self._secret_lookup.secrets_for(key_id))

        if secrets.is_empty():
            return SignatureVerification.failed(SignatureFailure.NO_SECRET)

        if not _any_secret_matches(secrets.usable(key_id), message, scheme):
            return SignatureVerification.failed(SignatureFailure.SIGNATURE_MISMATCH)

        timestamp_failure = self._timestamp_failure(message.timestamp, scheme.tolerance_ms)

        if timestamp_failure is not None:
            return SignatureVerification.failed(timestamp_failure)

        return SignatureVerification.passed()

    def _timestamp_failure(self, timestamp: str | None, tolerance_ms: int | None) -> SignatureFailure | None:
        if tolerance_ms is None:
            return None

        if timestamp is None:
            return SignatureFailure.TIMESTAMP_MISSING

        if _UNIX_SECONDS.fullmatch(timestamp) is None:
            return SignatureFailure.TIMESTAMP_MALFORMED

        if len(timestamp) > _MAX_TIMESTAMP_DIGITS:
            return SignatureFailure.TIMESTAMP_OUTSIDE_TOLERANCE

        signed_at_ms = int(timestamp) * _MILLISECONDS_PER_SECOND

        if abs(self._clock.now_milliseconds() - signed_at_ms) > tolerance_ms:
            return SignatureFailure.TIMESTAMP_OUTSIDE_TOLERANCE

        return None


# The payload with `{ts}` replaced by the timestamp text as received and `{rawBody}` by the raw bytes.
def _signed_payload(message: SignedMessage, scheme: SignatureScheme) -> bytes:
    before_body, after_body = scheme.payload.split(RAW_BODY_PLACEHOLDER, 1)
    timestamp = message.timestamp or ""

    return (
        before_body.replace(TIMESTAMP_PLACEHOLDER, timestamp).encode("utf-8")
        + message.raw_body
        + after_body.replace(TIMESTAMP_PLACEHOLDER, timestamp).encode("utf-8")
    )


# A candidate that does not decode in the declared encoding, or decodes to the wrong length, never matches. The
# patterns admit only text the decoders accept.
def _decoded_candidate(candidate: str, encoding: SignatureEncoding) -> bytes | None:
    if encoding is SignatureEncoding.HEX:
        decoded = bytes.fromhex(candidate) if _HEX.fullmatch(candidate) else None
    else:
        decoded = base64.b64decode(candidate, validate=True) if _BASE64.fullmatch(candidate) else None

    return decoded if decoded is not None and len(decoded) == _HMAC_SHA256_BYTES else None


# Every secret against every candidate, without stopping at the first match.
def _any_secret_matches(secrets: tuple[bytes, ...], message: SignedMessage, scheme: SignatureScheme) -> bool:
    payload = _signed_payload(message, scheme)
    candidates = [
        decoded
        for decoded in (_decoded_candidate(candidate, scheme.encoding) for candidate in message.candidate_signatures)
        if decoded is not None
    ]
    matched = False

    for secret in secrets:
        expected = hmac.new(secret, payload, hashlib.sha256).digest()

        for candidate in candidates:
            if hmac.compare_digest(expected, candidate):
                matched = True

    return matched
