"""A tampered bundle fails the pinned-bundle check naming the file that differs (ADR 0011)."""

import base64
import hashlib
import json
from pathlib import Path

from seampact.ir.bundle import BundleChannel, BundleFailureCode, BundleFiles, read_bundle_directory, verify_bundle
from seampact.ir.bundle.integrity import bundle_integrity
from seampact.ir.bundle.manifest import BundleFile

_MANIFEST = "seampact-bundle.json"


def _valid_vector(repository_root: Path) -> dict[str, object]:
    document = json.loads(
        (repository_root / "packages/core/spec/vectors/bundle/vectors.json").read_text(encoding="utf-8")
    )

    return next(vector for vector in document["directories"] if vector["id"] == "valid")


def _bundle_files(repository_root: Path) -> tuple[dict[str, bytes], str]:
    vector = _valid_vector(repository_root)
    files = {file["path"]: base64.b64decode(file["base64"]) for file in vector["files"]}  # type: ignore[attr-defined]

    return files, str(vector["pin"])


def _verify(files: dict[str, bytes], pin: str | None):  # type: ignore[no-untyped-def]
    return verify_bundle(
        BundleFiles({path: len(data) for path, data in files.items()}, files.__getitem__), pin, BundleChannel.RELEASE
    )


def _resealed(files: dict[str, bytes]) -> tuple[dict[str, bytes], str]:
    """The files with their manifest listing the current hashes, sizes and integrity."""
    manifest = json.loads(files[_MANIFEST])
    manifest["files"] = [
        {"path": path, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        for path, data in sorted(files.items())
        if path != _MANIFEST
    ]
    manifest["integrity"] = bundle_integrity(
        BundleFile(item["path"], item["size"], item["sha256"]) for item in manifest["files"]
    )

    return {**files, _MANIFEST: json.dumps(manifest).encode()}, manifest["integrity"]


def test_accepts_the_untouched_bundle(repository_root: Path) -> None:
    files, pin = _bundle_files(repository_root)

    assert _verify(files, pin).failures == ()


def test_names_each_file_whose_byte_changed(repository_root: Path) -> None:
    files, pin = _bundle_files(repository_root)
    listed = [path for path in files if path != _MANIFEST]
    assert len(listed) > 3

    for path in listed:
        tampered = {**files, path: files[path][:-1] + bytes([files[path][-1] ^ 1])}
        failures = _verify(tampered, pin).failures

        assert [(failure.code, failure.file) for failure in failures] == [(BundleFailureCode.FILE_HASH, path)]


def test_names_an_added_file(repository_root: Path) -> None:
    files, pin = _bundle_files(repository_root)

    failures = _verify({**files, "sources/extra.yaml": b"x: 1\n"}, pin).failures

    assert [(failure.code, failure.file) for failure in failures] == [
        (BundleFailureCode.FILE_UNLISTED, "sources/extra.yaml")
    ]


def test_refuses_a_resealed_bundle_with_the_old_pin(repository_root: Path) -> None:
    files, pin = _bundle_files(repository_root)
    resealed, integrity = _resealed({**files, "sources/api.yaml": b"changed: true\n"})

    verification = _verify(resealed, pin)

    assert [failure.code for failure in verification.failures] == [BundleFailureCode.PIN_MISMATCH]
    assert verification.integrity == integrity


def test_refuses_an_ir_the_json_schema_rejects(repository_root: Path) -> None:
    files, _ = _bundle_files(repository_root)
    ir = json.loads(files["ir/t.json"])
    ir["api"]["docs"] = "not an object"
    resealed, integrity = _resealed({**files, "ir/t.json": json.dumps(ir).encode()})

    failures = _verify(resealed, integrity).failures

    assert [(failure.code, failure.file) for failure in failures] == [(BundleFailureCode.IR_INVALID, "ir/t.json")]


def test_refuses_a_link_in_the_directory(repository_root: Path, tmp_path: Path) -> None:
    files, _ = _bundle_files(repository_root)

    for path, data in files.items():
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_bytes(data)

    (tmp_path / "sources" / "link.yaml").symlink_to(tmp_path / "sources" / "api.yaml")
    read = read_bundle_directory(tmp_path)

    assert not isinstance(read, BundleFiles)
    assert read.code is BundleFailureCode.FILE_TYPE
    assert read.file == "sources/link.yaml"
