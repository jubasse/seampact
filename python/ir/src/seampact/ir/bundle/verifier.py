"""The pinned-bundle check (ADR 0011), on the files of a bundle, in order: (0) the manifest; (1) every listed file
exists with its size and SHA-256, and no file is unlisted; (2) the integrity recomputed from the list equals the
manifest's, then the pin; (3) each api's IR (`check_api_ir`). A step runs only when the steps before it pass.
Every failure names its file or its two values; a missing or differing pin also gives the actual integrity, so
pinning is a copy. The codes and texts are those of the compiler's `bundle/verify.ts`."""

import hashlib
import re
from typing import Final

from seampact.ir.bundle.channel import BundleChannel
from seampact.ir.bundle.failure import BundleFailure, BundleFailureCode
from seampact.ir.bundle.files import BundleFiles
from seampact.ir.bundle.integrity import bundle_integrity
from seampact.ir.bundle.ir_check import check_api_ir
from seampact.ir.bundle.layout import MANIFEST_BYTES_MAX, MANIFEST_FILE, REFETCH_FIX
from seampact.ir.bundle.manifest import BundleFile, BundleManifest
from seampact.ir.bundle.manifest_reader import manifest_too_large, read_manifest
from seampact.ir.bundle.verification import BundleVerification, refused
from seampact.ir.https.untrusted_text import quoted

_NPM_PACKAGE_MANIFEST: Final = "package.json"
_NPM_ALWAYS_INCLUDED: Final = re.compile(
    r"(?:readme|license|licence|changelog)(?:[.-].*)?\Z", re.IGNORECASE | re.DOTALL
)


def verify_bundle(files: BundleFiles, pinned_integrity: str | None, channel: BundleChannel) -> BundleVerification:
    """Runs the checks on `files` against the pinned integrity (`None`: no pin)."""
    manifest_size = files.sizes.get(MANIFEST_FILE)

    if manifest_size is None:
        return refused(
            [
                BundleFailure(
                    BundleFailureCode.MANIFEST_MISSING,
                    f"The bundle has no '{MANIFEST_FILE}' at its root.",
                    "Check that the source names a seampact bundle (`seampact bundle` writes the manifest).",
                    MANIFEST_FILE,
                )
            ]
        )

    if manifest_size > MANIFEST_BYTES_MAX:
        return refused([manifest_too_large(manifest_size)])

    manifest = read_manifest(files.read(MANIFEST_FILE))

    if isinstance(manifest, BundleFailure):
        return refused([manifest])

    bytes_by_path: dict[str, bytes] = {}
    file_failures = _file_failures(files, manifest, channel, bytes_by_path)

    if file_failures:
        return refused(file_failures)

    integrity = bundle_integrity(manifest.files)
    integrity_failure = _integrity_failure(manifest, integrity, pinned_integrity)

    if integrity_failure is not None:
        return refused([integrity_failure], integrity)

    return _check_irs(manifest, bytes_by_path, integrity)


def _check_irs(manifest: BundleManifest, bytes_by_path: dict[str, bytes], integrity: str) -> BundleVerification:
    irs = {}
    ir_bytes = {}
    failures = []

    for api in manifest.apis:
        # The manifest rules list every api's file, and step 1 read every listed file.
        data = bytes_by_path[api.file]
        checked = check_api_ir(api, data)

        if isinstance(checked, BundleFailure):
            failures.append(checked)
        else:
            irs[api.name] = checked
            ir_bytes[api.name] = data

    if failures:
        return refused(failures, integrity)

    return BundleVerification(manifest=manifest, integrity=integrity, irs=irs, ir_bytes=ir_bytes)


def _file_failures(
    files: BundleFiles, manifest: BundleManifest, channel: BundleChannel, bytes_by_path: dict[str, bytes]
) -> list[BundleFailure]:
    """Step 1: every file failure in path order (listed files, then unlisted ones); `bytes_by_path` gets the bytes
    of every listed file that passed."""
    failures = []

    for file in manifest.files:
        failure = _file_failure(files, file, bytes_by_path)

        if failure is not None:
            failures.append(failure)

    listed = {file.path for file in manifest.files}
    unlisted = sorted(
        path for path in files.sizes if path != MANIFEST_FILE and path not in listed and not _is_npm_file(path, channel)
    )

    for path in unlisted:
        failures.append(
            BundleFailure(
                BundleFailureCode.FILE_UNLISTED,
                f"{quoted(path)} is in the bundle and not listed in the manifest.",
                REFETCH_FIX,
                path,
            )
        )

    return failures


def _file_failure(files: BundleFiles, file: BundleFile, bytes_by_path: dict[str, bytes]) -> BundleFailure | None:
    size = files.sizes.get(file.path)

    if size is None:
        return BundleFailure(
            BundleFailureCode.FILE_MISSING,
            f"'{file.path}' is listed in the manifest and missing from the bundle.",
            REFETCH_FIX,
            file.path,
        )

    if size != file.size:
        return BundleFailure(
            BundleFailureCode.FILE_SIZE,
            f"'{file.path}' holds {size} bytes; the manifest lists {file.size}.",
            REFETCH_FIX,
            file.path,
            str(file.size),
            str(size),
        )

    data = files.read(file.path)
    sha256 = hashlib.sha256(data).hexdigest()

    if sha256 != file.sha256:
        return BundleFailure(
            BundleFailureCode.FILE_HASH,
            f"'{file.path}' has the SHA-256 {sha256}; the manifest lists {file.sha256}.",
            REFETCH_FIX,
            file.path,
            file.sha256,
            sha256,
        )

    bytes_by_path[file.path] = data

    return None


def _is_npm_file(path: str, channel: BundleChannel) -> bool:
    if channel is not BundleChannel.PACKAGE or "/" in path:
        return False

    return path == _NPM_PACKAGE_MANIFEST or _NPM_ALWAYS_INCLUDED.match(path) is not None


def _integrity_failure(manifest: BundleManifest, integrity: str, pinned_integrity: str | None) -> BundleFailure | None:
    """Step 2: the manifest's integrity against the recomputed one, then the pin against both."""
    if manifest.integrity != integrity:
        return BundleFailure(
            BundleFailureCode.INTEGRITY_MISMATCH,
            f"The manifest's integrity is {manifest.integrity}; its file list gives {integrity}.",
            REFETCH_FIX,
            MANIFEST_FILE,
            manifest.integrity,
            integrity,
        )

    if pinned_integrity is None:
        return BundleFailure(
            BundleFailureCode.PIN_MISSING,
            f"The bundle source pins no integrity; the bundle's is {integrity}.",
            f"Review the bundle, then pin it: integrity: {integrity}",
            actual=integrity,
        )

    if pinned_integrity != integrity:
        return BundleFailure(
            BundleFailureCode.PIN_MISMATCH,
            f"The pinned integrity is {quoted(pinned_integrity)}; the bundle's is {integrity}.",
            f"Fetch the bundle the pin names, or review this one and pin it: integrity: {integrity}",
            expected=pinned_integrity,
            actual=integrity,
        )

    return None
