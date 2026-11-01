"""Why a bundle is refused: the codes of `@seampact/spec/bundle`, so every native verifier reports the same code."""

from dataclasses import dataclass
from enum import StrEnum


class BundleFailureCode(StrEnum):
    MANIFEST_MISSING = "bundle.manifest-missing"
    MANIFEST_TOO_LARGE = "bundle.manifest-too-large"
    MANIFEST_INVALID = "bundle.manifest-invalid"
    FILE_MISSING = "bundle.file-missing"
    FILE_SIZE = "bundle.file-size"
    FILE_HASH = "bundle.file-hash"
    FILE_UNLISTED = "bundle.file-unlisted"
    FILE_TYPE = "bundle.file-type"
    TOO_MANY_FILES = "bundle.too-many-files"
    TOO_LARGE = "bundle.too-large"
    INTEGRITY_MISMATCH = "bundle.integrity-mismatch"
    PIN_MISSING = "bundle.pin-missing"
    PIN_MISMATCH = "bundle.pin-mismatch"
    IR_UNREADABLE = "bundle.ir-unreadable"
    IR_DECLARATION = "bundle.ir-declaration"
    IR_VERSION = "bundle.ir-version"
    IR_REVISION = "bundle.ir-revision"
    IR_INVALID = "bundle.ir-invalid"
    ARCHIVE_TOO_LARGE = "bundle.archive-too-large"
    ARCHIVE_EXTRACTED_TOO_LARGE = "bundle.archive-extracted-too-large"
    ARCHIVE_TOO_MANY_ENTRIES = "bundle.archive-too-many-entries"
    ARCHIVE_INVALID = "bundle.archive-invalid"
    ARCHIVE_ENTRY_PATH = "bundle.archive-entry-path"
    ARCHIVE_ENTRY_TYPE = "bundle.archive-entry-type"
    ARCHIVE_ENTRY_DUPLICATE = "bundle.archive-entry-duplicate"
    RELEASE_URL = "bundle.release-url"
    RELEASE_FAILED = "bundle.release-failed"
    GIT_URL = "bundle.git-url"
    GIT_TAG = "bundle.git-tag"
    GIT_DIRECTORY = "bundle.git-directory"
    GIT_FAILED = "bundle.git-failed"
    SOURCE_LOCAL = "bundle.source-local"
    CACHE_INVALID = "bundle.cache-invalid"
    PACKAGE_UNSUPPORTED = "bundle.package-unsupported"
    MAVEN_JVM_ONLY = "bundle.maven-jvm-only"


@dataclass(frozen=True, slots=True)
class BundleFailure:
    """`file` is the bundle path, archive entry or manifest the failure is about; `expected` and `actual` are the
    two values that differ (the manifest's or the pin, and what was found). Untrusted names are quoted in `message`
    and kept exact in `file`."""

    code: BundleFailureCode
    message: str
    fix: str
    file: str | None = None
    expected: str | None = None
    actual: str | None = None
