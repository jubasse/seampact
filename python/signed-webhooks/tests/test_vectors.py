"""The ADR 0013 test vectors every ecosystem's helper passes, read from the npm package's vector file."""

import base64
import hashlib
import hmac
import json
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Final

import pytest

from seampact.signed_webhooks import (
    SUPPORTED_ALGORITHM,
    EmptySignatureSecretError,
    SignatureEncoding,
    SignatureFailure,
    SignaturePayloadInvalidError,
    SignatureScheme,
    SignatureToleranceInvalidError,
    SignedMessage,
    TemplateSignatureVerifier,
    UnsupportedSignatureAlgorithmError,
)

# python/signed-webhooks/tests/test_vectors.py: the repository root is three directories up from this one.
_VECTORS_PATH: Final = Path(__file__).resolve().parents[3] / "packages/runtime/signed-webhooks/vectors/adr-0013.json"
_KEY_ID: Final = "test"
_MILLISECONDS_PER_SECOND: Final = 1000
_FIVE_MINUTES_MS: Final = 300_000
_PAIR_FORMAT: Final = re.compile(r"(?:[A-Za-z0-9]+=\{(?:ts|sig)\},?)+")
_TIMESTAMP_PLACEHOLDER: Final = "{ts}"
_SIGNATURE_PLACEHOLDER: Final = "{sig}"

# Why each 401 vector fails: a wrong MAC, or a timestamp outside the tolerance.
_FAILURE_OF_VECTOR: Final = {
    "G3": SignatureFailure.SIGNATURE_MISMATCH,
    "S3": SignatureFailure.TIMESTAMP_OUTSIDE_TOLERANCE,
    "S4": SignatureFailure.TIMESTAMP_OUTSIDE_TOLERANCE,
    "S5": SignatureFailure.SIGNATURE_MISMATCH,
    "S8": SignatureFailure.SIGNATURE_MISMATCH,
}


class _FixedLookup:
    def __init__(self, secrets: Sequence[str | bytes]) -> None:
        self._secrets = secrets

    def secrets_for(self, key_id: str) -> Sequence[str | bytes]:
        return self._secrets if key_id == _KEY_ID else []


class _FixedClock:
    def __init__(self, now_milliseconds: int) -> None:
        self._now_milliseconds = now_milliseconds

    def now_milliseconds(self) -> int:
        return self._now_milliseconds


def _vectors() -> dict[str, Any]:
    vectors: dict[str, Any] = json.loads(_VECTORS_PATH.read_text(encoding="utf-8"))

    return vectors


def _cases() -> list[tuple[dict[str, Any], dict[str, Any]]]:
    vectors = _vectors()

    return [(case, vectors["schemes"][case["scheme"]]) for case in vectors["cases"]]


# The header parsing the generated boundary does (ADR 0013 "Header parsing is fixed by the format"), enough for the
# two formats of the vectors.
def _parse_signature_header(header_format: str, header: str) -> tuple[str | None, tuple[str, ...]]:
    if _PAIR_FORMAT.fullmatch(header_format) is None:
        prefix = header_format.replace(_SIGNATURE_PLACEHOLDER, "")

        return None, (header.removeprefix(prefix),) if header.startswith(prefix) else ()

    placeholder_of_name = dict(item.split("=", 1) for item in header_format.split(","))
    timestamp: str | None = None
    candidates: list[str] = []

    for pair in header.split(","):
        name, _, value = pair.partition("=")
        placeholder = placeholder_of_name.get(name)

        if placeholder == _TIMESTAMP_PLACEHOLDER:
            timestamp = value
        elif placeholder == _SIGNATURE_PLACEHOLDER:
            candidates.append(value)

    return timestamp, tuple(candidates)


def _scheme(scheme: dict[str, Any]) -> SignatureScheme:
    return SignatureScheme(
        scheme["algorithm"], scheme["payload"], SignatureEncoding(scheme["encoding"]), scheme.get("toleranceMs")
    )


def _github_scheme() -> SignatureScheme:
    return SignatureScheme(SUPPORTED_ALGORITHM, "{rawBody}", SignatureEncoding.HEX)


def _timestamp_scheme() -> SignatureScheme:
    return SignatureScheme(SUPPORTED_ALGORITHM, "{ts}.{rawBody}", SignatureEncoding.HEX, _FIVE_MINUTES_MS)


def _hex_mac(payload: bytes, secret: bytes) -> str:
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()


def test_the_vector_file_holds_every_case() -> None:
    identifiers = [case["id"] for case, _ in _cases()]

    assert identifiers == ["G1", "G2", "G3", *(f"S{number}" for number in range(1, 10))]


@pytest.mark.parametrize(("case", "scheme"), _cases(), ids=lambda value: str(value.get("id", "")))
def test_vector(case: dict[str, Any], scheme: dict[str, Any]) -> None:
    timestamp, candidates = _parse_signature_header(scheme["format"], case["header"])
    now_milliseconds = case.get("nowSeconds", 0) * _MILLISECONDS_PER_SECOND
    verifier = TemplateSignatureVerifier(_FixedLookup(case["secrets"]), _FixedClock(now_milliseconds))
    message = SignedMessage(case["body"].encode("utf-8"), timestamp, candidates)

    verification = verifier.verify(message, _KEY_ID, _scheme(scheme))

    assert ("pass" if verification.verified else "401") == case["expected"]
    assert verification.failure == _FAILURE_OF_VECTOR.get(case["id"])


def test_refuses_an_empty_secret_by_name() -> None:
    verifier = TemplateSignatureVerifier(_FixedLookup([b"current", ""]))

    with pytest.raises(EmptySignatureSecretError) as refusal:
        verifier.verify(SignedMessage(b"Hello, World!", None, ("00",)), _KEY_ID, _github_scheme())

    assert refusal.value.index == 1
    assert EmptySignatureSecretError.CODE == "signature.secret.empty"


def test_refuses_another_algorithm_by_name() -> None:
    verifier = TemplateSignatureVerifier(_FixedLookup(["secret"]))
    scheme = SignatureScheme("hmac-sha512", "{rawBody}", SignatureEncoding.HEX)

    with pytest.raises(UnsupportedSignatureAlgorithmError, match="'hmac-sha512'"):
        verifier.verify(SignedMessage(b"", None, ()), _KEY_ID, scheme)


def test_fails_without_a_secret_for_the_key() -> None:
    verification = TemplateSignatureVerifier(_FixedLookup([])).verify(
        SignedMessage(b"Hello, World!", None, ()), _KEY_ID, _github_scheme()
    )

    assert verification.failure is SignatureFailure.NO_SECRET


def test_refuses_a_scheme_that_signs_the_timestamp_without_a_tolerance() -> None:
    with pytest.raises(SignatureToleranceInvalidError, match="no tolerance"):
        SignatureScheme(SUPPORTED_ALGORITHM, "{ts}.{rawBody}", SignatureEncoding.HEX)


@pytest.mark.parametrize(
    ("payload", "tolerance_ms"),
    [("{ts}.{rawBody}", -1), ("{ts}.{rawBody}", True), ("{ts}.{rawBody}", float("nan")), ("{rawBody}", 1000)],
    ids=["negative", "a bool", "not a number", "without a timestamp"],
)
def test_refuses_a_tolerance_that_does_not_fit_the_payload(payload: str, tolerance_ms: Any) -> None:
    with pytest.raises(SignatureToleranceInvalidError):
        SignatureScheme(SUPPORTED_ALGORITHM, payload, SignatureEncoding.HEX, tolerance_ms)

    assert SignatureToleranceInvalidError.CODE == "signature.tolerance.invalid"


@pytest.mark.parametrize(
    "payload",
    ["{ts}.", "", "{rawBody}{rawBody}", "{ts}{ts}{rawBody}"],
    ids=["no body", "empty", "body twice", "timestamp twice"],
)
def test_refuses_a_payload_that_does_not_hold_the_raw_body_once(payload: str) -> None:
    with pytest.raises(SignaturePayloadInvalidError):
        SignatureScheme(SUPPORTED_ALGORITHM, payload, SignatureEncoding.HEX, 1000)


def test_refuses_an_unknown_encoding() -> None:
    with pytest.raises(ValueError, match="'base32'"):
        SignatureScheme(SUPPORTED_ALGORITHM, "{rawBody}", "base32")  # type: ignore[arg-type]


def test_fails_when_the_signed_timestamp_is_missing() -> None:
    verification = TemplateSignatureVerifier(_FixedLookup(["secret"])).verify(
        SignedMessage(b"Hello, World!", None, ("00",)), _KEY_ID, _timestamp_scheme()
    )

    assert verification.failure is SignatureFailure.TIMESTAMP_MISSING


@pytest.mark.parametrize(
    "timestamp", ["1e9", "17000000\n", "\u0661\u0667\u0660\u0660"], ids=["exponent", "newline", "arabic digits"]
)
def test_fails_when_the_signed_timestamp_is_not_unix_seconds(timestamp: str) -> None:
    signature = _hex_mac(f"{timestamp}.Hello, World!".encode(), b"secret")
    verifier = TemplateSignatureVerifier(_FixedLookup(["secret"]), _FixedClock(0))

    verification = verifier.verify(
        SignedMessage(b"Hello, World!", timestamp, (signature,)), _KEY_ID, _timestamp_scheme()
    )

    assert verification.failure is SignatureFailure.TIMESTAMP_MALFORMED


def test_a_timestamp_too_long_for_a_number_is_outside_the_tolerance() -> None:
    timestamp = "9" * 5000
    signature = _hex_mac(f"{timestamp}.Hello, World!".encode(), b"secret")
    verifier = TemplateSignatureVerifier(_FixedLookup(["secret"]), _FixedClock(0))

    verification = verifier.verify(
        SignedMessage(b"Hello, World!", timestamp, (signature,)), _KEY_ID, _timestamp_scheme()
    )

    assert verification.failure is SignatureFailure.TIMESTAMP_OUTSIDE_TOLERANCE


def test_a_candidate_that_is_not_hex_never_matches() -> None:
    signature = _hex_mac(b"Hello, World!", b"secret")
    verifier = TemplateSignatureVerifier(_FixedLookup(["secret"]))

    verification = verifier.verify(
        SignedMessage(b"Hello, World!", None, ("g" + signature[1:],)), _KEY_ID, _github_scheme()
    )

    assert verification.failure is SignatureFailure.SIGNATURE_MISMATCH


def test_a_candidate_of_the_wrong_length_never_matches() -> None:
    truncated_mac = hmac.new(b"secret", b"Hello, World!", hashlib.sha256).digest()[:31]
    scheme = SignatureScheme(SUPPORTED_ALGORITHM, "{rawBody}", SignatureEncoding.BASE64)
    verifier = TemplateSignatureVerifier(_FixedLookup(["secret"]))

    verification = verifier.verify(
        SignedMessage(b"Hello, World!", None, (base64.b64encode(truncated_mac).decode(),)), _KEY_ID, scheme
    )

    assert verification.failure is SignatureFailure.SIGNATURE_MISMATCH


def test_a_bytes_secret_verifies_as_its_text() -> None:
    signature = _hex_mac(b"Hello, World!", b"secret")
    verifier = TemplateSignatureVerifier(_FixedLookup([b"secret"]))

    verification = verifier.verify(SignedMessage(b"Hello, World!", None, (signature,)), _KEY_ID, _github_scheme())

    assert verification.verified
