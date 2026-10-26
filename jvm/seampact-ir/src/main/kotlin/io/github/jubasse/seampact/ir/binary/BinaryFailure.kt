package io.github.jubasse.seampact.ir.binary

/** Why the pinned standalone compiler binary cannot be used (ADR 0010, "Distribution and pinning"). */
public enum class BinaryFailureCode(public val code: String) {
    PLATFORM_UNSUPPORTED("binary.platform-unsupported"),
    PIN_MISSING("binary.pin-missing"),
    PIN_INVALID("binary.pin-invalid"),
    HASH_MISMATCH("binary.hash-mismatch"),
    CACHE_UNSAFE("binary.cache-unsafe"),

    /** The cache directory is relative, so the working directory would decide where the binary runs from. */
    CACHE_UNAVAILABLE("binary.cache-unavailable"),
    COMPILE_TIMEOUT("binary.compile-timeout"),

    /** The binary refused the compile (exit 1) or its usage (exit 2), with its diagnostics. */
    COMPILE_REFUSED("binary.compile-refused"),

    /** The binary left its contract: an exit other than 0, 1 or 2, a signal, or an IR file missing after exit 0. */
    COMPILE_FAILED("binary.compile-failed"),

    /** The build plugin could not resolve the pinned release artefact through the build's repositories. */
    ARTEFACT_UNRESOLVED("binary.artefact-unresolved"),
}

/** One named reason, its fix and, when two values differ, both of them. */
public data class BinaryFailure(
    val code: BinaryFailureCode,
    val message: String,
    val fix: String,
    val expected: String? = null,
    val actual: String? = null,
)
