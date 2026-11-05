"""The pins `seampact-ir` embeds: the empty pin before publication, a release pin, and the refused ones."""

import json

import pytest

from seampact.ir.binary import BinaryFailureCode, BinaryRefusedError
from seampact.ir.binary.pins import BinaryPins, embedded_pins
from seampact.ir.binary.release_assets import BINARIES

_HASH_BY_ASSET = {asset: f"{index:064x}" for index, asset in enumerate(BINARIES)}


def _pins_text(version: str | None, hashes: dict[str, str]) -> str:
    return json.dumps({"version": version, "sha256": hashes})


def test_the_empty_pin_reads_as_no_pin() -> None:
    assert embedded_pins(_pins_text(None, {})) is None


def test_a_release_pin_reads_as_its_version_and_hashes() -> None:
    assert embedded_pins(_pins_text("1.0.0", _HASH_BY_ASSET)) == BinaryPins("1.0.0", _HASH_BY_ASSET)


def test_a_pin_at_the_development_version_is_refused_by_name() -> None:
    with pytest.raises(BinaryRefusedError) as refusal:
        embedded_pins(_pins_text("0.0.0", _HASH_BY_ASSET))

    assert refusal.value.failure.code is BinaryFailureCode.PIN_INVALID
    assert "development pin" in str(refusal.value)
