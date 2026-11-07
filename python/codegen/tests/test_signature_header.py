"""A template scheme's signature header parses as every target parses it (ADR 0013 "Test vectors")."""

import pytest

from seampact.codegen.runtime.signature_header import parsed_signature_header

STRIPE_FORMAT = "t={ts},v1={sig}"
PREFIXED_FORMAT = "sha256={sig}"


def test_a_pair_format_reads_the_timestamp_and_every_repeated_signature() -> None:
    parsed = parsed_signature_header(STRIPE_FORMAT, "t=1700000000, v1=abc,v0=ignored,v1=def")

    assert parsed is not None
    assert parsed.timestamp == "1700000000"
    assert parsed.candidate_signatures == ("abc", "def")


def test_a_prefix_format_reads_the_signature_after_its_prefix() -> None:
    parsed = parsed_signature_header(PREFIXED_FORMAT, "sha256=0a1b")

    assert parsed is not None
    assert parsed.timestamp is None
    assert parsed.candidate_signatures == ("0a1b",)


@pytest.mark.parametrize(
    ("format_", "header"),
    [
        pytest.param(STRIPE_FORMAT, None, id="missing"),
        pytest.param(STRIPE_FORMAT, "  ", id="blank"),
        pytest.param(STRIPE_FORMAT, "t=1700000000", id="no signature"),
        pytest.param(STRIPE_FORMAT, "v1=abc", id="no timestamp"),
        pytest.param(STRIPE_FORMAT, "t=soon,v1=abc", id="timestamp not digits"),
        pytest.param(STRIPE_FORMAT, "t=1,t=2,v1=abc", id="repeated timestamp"),
        pytest.param(STRIPE_FORMAT, "t=1,v1=", id="empty signature"),
        pytest.param(STRIPE_FORMAT, "t=1,=abc,v1=abc", id="pair without name"),
        pytest.param(STRIPE_FORMAT, "t=1,v1=abc,junk", id="pair without value"),
        pytest.param(PREFIXED_FORMAT, "sha1=0a1b", id="other prefix"),
        pytest.param(PREFIXED_FORMAT, "sha256=", id="prefix only"),
    ],
)
def test_a_malformed_header_parses_to_nothing(format_: str, header: str | None) -> None:
    assert parsed_signature_header(format_, header) is None


def test_a_repr_redacts_the_signatures() -> None:
    parsed = parsed_signature_header(STRIPE_FORMAT, "t=1,v1=secret-mac")

    assert "secret-mac" not in repr(parsed)
