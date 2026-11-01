"""The shared bundle vectors (`packages/core/spec/vectors/bundle/vectors.json`): every field a vector records."""

import base64
import json
from pathlib import Path

import pytest

from seampact.ir.bundle import (
    BundleChannel,
    BundleFailure,
    BundleFiles,
    read_bundle_archive,
    read_bundle_directory,
    verify_bundle,
)

_VECTORS = "packages/core/spec/vectors/bundle/vectors.json"


def _vectors(kind: str) -> list[dict[str, object]]:
    document = json.loads((Path(__file__).resolve().parents[3] / _VECTORS).read_text(encoding="utf-8"))

    return [vector for vector in document[kind] if isinstance(vector, dict)]


def _recorded(failure: BundleFailure) -> dict[str, str]:
    members = {"code": failure.code.value, "file": failure.file, "expected": failure.expected, "actual": failure.actual}

    return {name: value for name, value in members.items() if value is not None}


def _expected_failures(expected: dict[str, object]) -> list[dict[str, str]]:
    failures = expected["failures"]
    assert isinstance(failures, list)

    return [{name: str(value) for name, value in failure.items()} for failure in failures]


@pytest.mark.parametrize("vector", _vectors("directories"), ids=lambda vector: str(vector["id"]))
def test_verifies_the_directory_as_the_vector_records(vector: dict[str, object], tmp_path: Path) -> None:
    files = vector["files"]
    assert isinstance(files, list)

    for file in files:
        target = tmp_path / file["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(file["base64"], validate=True))

    read = read_bundle_directory(tmp_path)
    assert isinstance(read, BundleFiles)

    pin = vector["pin"]
    verification = verify_bundle(read, pin if isinstance(pin, str) else None, BundleChannel(str(vector["channel"])))

    expected = vector["expected"]
    assert isinstance(expected, dict)
    assert verification.ok is expected["ok"]
    assert verification.integrity == expected["integrity"]
    assert [_recorded(failure) for failure in verification.failures] == _expected_failures(expected)


@pytest.mark.parametrize("vector", _vectors("archives"), ids=lambda vector: str(vector["id"]))
def test_reads_the_archive_as_the_vector_records(vector: dict[str, object]) -> None:
    read = read_bundle_archive(base64.b64decode(str(vector["base64"]), validate=True))

    expected = vector["expected"]
    assert isinstance(expected, dict)
    assert (not isinstance(read, BundleFailure)) is expected["ok"]
    assert (list(read.sizes) if isinstance(read, BundleFiles) else []) == expected["paths"]
    assert ([_recorded(read)] if isinstance(read, BundleFailure) else []) == _expected_failures(expected)


def test_verifies_the_valid_archive_in_memory_against_the_pin() -> None:
    archive = next(vector for vector in _vectors("archives") if vector["id"] == "valid")
    directory = next(vector for vector in _vectors("directories") if vector["id"] == "valid")
    read = read_bundle_archive(base64.b64decode(str(archive["base64"]), validate=True))
    assert isinstance(read, BundleFiles)

    verification = verify_bundle(read, str(directory["pin"]), BundleChannel.RELEASE)

    assert verification.failures == ()
    assert list(verification.irs) == ["t"]
