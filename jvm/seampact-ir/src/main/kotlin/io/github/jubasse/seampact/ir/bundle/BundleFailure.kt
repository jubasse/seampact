package io.github.jubasse.seampact.ir.bundle

/**
 * The failure codes of the archive reader and the pinned-bundle check (ADR 0011), the codes of
 * `@seampact/spec/bundle`: a native verifier reports the same code for the same bundle. The fetch codes after them
 * are those of the Node runner's `fetch-failure.ts`, plus the JVM's own (`package-unsupported`,
 * `artefact-unreadable`).
 */
public enum class BundleFailureCode(public val code: String) {
    MANIFEST_MISSING("bundle.manifest-missing"),
    MANIFEST_TOO_LARGE("bundle.manifest-too-large"),
    MANIFEST_INVALID("bundle.manifest-invalid"),
    FILE_MISSING("bundle.file-missing"),
    FILE_SIZE("bundle.file-size"),
    FILE_HASH("bundle.file-hash"),
    FILE_UNLISTED("bundle.file-unlisted"),
    FILE_TYPE("bundle.file-type"),
    TOO_MANY_FILES("bundle.too-many-files"),
    TOO_LARGE("bundle.too-large"),
    INTEGRITY_MISMATCH("bundle.integrity-mismatch"),
    PIN_MISSING("bundle.pin-missing"),
    PIN_MISMATCH("bundle.pin-mismatch"),
    IR_UNREADABLE("bundle.ir-unreadable"),
    IR_DECLARATION("bundle.ir-declaration"),
    IR_VERSION("bundle.ir-version"),
    IR_REVISION("bundle.ir-revision"),
    IR_INVALID("bundle.ir-invalid"),
    ARCHIVE_TOO_LARGE("bundle.archive-too-large"),
    ARCHIVE_INVALID("bundle.archive-invalid"),
    ARCHIVE_ENTRY_PATH("bundle.archive-entry-path"),
    ARCHIVE_ENTRY_TYPE("bundle.archive-entry-type"),
    ARCHIVE_ENTRY_DUPLICATE("bundle.archive-entry-duplicate"),
    ARCHIVE_TOO_MANY_ENTRIES("bundle.archive-too-many-entries"),
    ARCHIVE_EXTRACTED_TOO_LARGE("bundle.archive-extracted-too-large"),
    RELEASE_URL("bundle.release-url"),
    RELEASE_FAILED("bundle.release-failed"),
    GIT_URL("bundle.git-url"),
    GIT_TAG("bundle.git-tag"),
    GIT_DIRECTORY("bundle.git-directory"),
    GIT_FAILED("bundle.git-failed"),
    SOURCE_LOCAL("bundle.source-local"),
    CACHE_INVALID("bundle.cache-invalid"),
    PACKAGE_UNSUPPORTED("bundle.package-unsupported"),
    ARTEFACT_UNREADABLE("bundle.artefact-unreadable"),
}

/**
 * Why a bundle is refused. [file] is the bundle path, archive entry or manifest the failure is about; [expected]
 * and [actual] are the two values that differ (the manifest's or the pin, and what was found). Untrusted names are
 * quoted in [message] and kept exact in [file].
 */
public data class BundleFailure(
    val code: BundleFailureCode,
    val message: String,
    val fix: String,
    val file: String? = null,
    val expected: String? = null,
    val actual: String? = null,
)
