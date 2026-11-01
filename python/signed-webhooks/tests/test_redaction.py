"""The raw body, the signatures and the secrets never show in a repr, a log line or a captured frame."""

import hmac
import logging
import os
import pprint
import traceback
from collections.abc import Sequence
from typing import Final

import pytest
from rich.pretty import pretty_repr

from seampact.signed_webhooks import (
    SUPPORTED_ALGORITHM,
    EmptySignatureSecretError,
    SignatureEncoding,
    SignatureScheme,
    SignedMessage,
    TemplateSignatureVerifier,
)

_CURRENT_SECRET: Final = "whsec_CURRENT_SECRET"
_SENSITIVE_BODY: Final = b'{"card":"4242 4242 4242 4242"}'
_SENSITIVE_SIGNATURE: Final = "5ac1ab1e" * 8
_REDACTED: Final = "[redacted]"


class _LookupWithAnUnsetSecret:
    """A rotation list whose second secret comes from an unset environment variable."""

    def secrets_for(self, key_id: str) -> Sequence[str | bytes]:
        unset_secret: str | None = None

        return [_CURRENT_SECRET, unset_secret]  # type: ignore[list-item]


def _sensitive_message() -> SignedMessage:
    return SignedMessage(_SENSITIVE_BODY, "1700000000", (_SENSITIVE_SIGNATURE,))


def _assert_redacted(text: str) -> None:
    assert _REDACTED in text
    assert "4242" not in text
    assert _SENSITIVE_SIGNATURE not in text
    assert _CURRENT_SECRET not in text


@pytest.mark.parametrize("render", [repr, str, pprint.pformat, pretty_repr], ids=["repr", "str", "pprint", "rich"])
def test_a_signed_message_renders_redacted(render: object) -> None:
    assert callable(render)

    _assert_redacted(render(_sensitive_message()))


def test_a_logged_signed_message_is_redacted(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO):
        logging.getLogger("seampact.test").info("received %r", _sensitive_message())

    _assert_redacted(caplog.text)


def test_a_refused_secret_leaves_no_secret_or_body_in_the_captured_frames() -> None:
    verifier = TemplateSignatureVerifier(_LookupWithAnUnsetSecret())
    scheme = SignatureScheme(SUPPORTED_ALGORITHM, "{rawBody}", SignatureEncoding.HEX)

    with pytest.raises(EmptySignatureSecretError) as refusal:
        verifier.verify(_sensitive_message(), "test", scheme)

    frames = "".join(traceback.TracebackException.from_exception(refusal.value, capture_locals=True).format())

    assert refusal.value.index == 1
    assert "verifier.py" in frames
    _assert_redacted(frames)


_NOT_UTF8_SECRET_TEXT: Final = "whsec_NOT_UTF8_SECRET"


class _LookupWithACurrentSecret:
    def secrets_for(self, key_id: str) -> Sequence[str | bytes]:
        return [_CURRENT_SECRET]


class _LookupReadingTheEnvironment:
    """A secret read from `os.environ`, where a byte that is not UTF-8 decodes as a lone surrogate."""

    def secrets_for(self, key_id: str) -> Sequence[str | bytes]:
        return [_CURRENT_SECRET, os.environ["SEAMPACT_TEST_WEBHOOK_SECRET"]]


def _captured_frames(error: BaseException) -> str:
    return "".join(traceback.TracebackException.from_exception(error, capture_locals=True).format())


def _assert_no_secret(text: str) -> None:
    assert _CURRENT_SECRET not in text
    assert _CURRENT_SECRET.encode().hex() not in text
    assert _NOT_UTF8_SECRET_TEXT not in text


def test_a_failure_inside_the_mac_loop_leaves_no_secret_in_the_captured_frames(monkeypatch: pytest.MonkeyPatch) -> None:
    def failing_compare(expected: bytes, candidate: bytes) -> bool:
        raise RuntimeError("compare failed")

    monkeypatch.setattr(hmac, "compare_digest", failing_compare)
    verifier = TemplateSignatureVerifier(_LookupWithACurrentSecret())
    scheme = SignatureScheme(SUPPORTED_ALGORITHM, "{rawBody}", SignatureEncoding.HEX)

    with pytest.raises(RuntimeError) as failure:
        verifier.verify(_sensitive_message(), "test", scheme)

    frames = _captured_frames(failure.value)

    assert "verifier.py" in frames
    _assert_no_secret(frames)


def test_a_body_of_the_wrong_type_leaves_no_secret_in_the_captured_frames() -> None:
    verifier = TemplateSignatureVerifier(_LookupWithACurrentSecret())
    scheme = SignatureScheme(SUPPORTED_ALGORITHM, "{rawBody}", SignatureEncoding.HEX)
    message_with_a_text_body = SignedMessage("not bytes", "1700000000", (_SENSITIVE_SIGNATURE,))  # type: ignore[arg-type]

    with pytest.raises(TypeError) as failure:
        verifier.verify(message_with_a_text_body, "test", scheme)

    _assert_no_secret(_captured_frames(failure.value))


def test_a_secret_that_is_not_utf8_is_refused_without_showing_it(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SEAMPACT_TEST_WEBHOOK_SECRET", os.fsdecode(_NOT_UTF8_SECRET_TEXT.encode() + b"\xff"))
    verifier = TemplateSignatureVerifier(_LookupReadingTheEnvironment())
    scheme = SignatureScheme(SUPPORTED_ALGORITHM, "{rawBody}", SignatureEncoding.HEX)

    with pytest.raises(EmptySignatureSecretError) as refusal:
        verifier.verify(_sensitive_message(), "test", scheme)

    assert refusal.value.index == 1
    assert refusal.value.__cause__ is None
    assert refusal.value.__context__ is None
    _assert_no_secret(str(refusal.value))
    _assert_no_secret(_captured_frames(refusal.value))
