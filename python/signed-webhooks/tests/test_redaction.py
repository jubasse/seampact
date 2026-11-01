"""The raw body, the signatures and the secrets never show in a repr, a log line or a captured frame."""

import logging
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
