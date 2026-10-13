package io.github.jubasse.seampact.ir.read

import io.github.jubasse.seampact.ir.model.IrModelVersion

/**
 * What a reader declares it reads (ADR 0005 sections 2 and 3), mirroring `IrSupport` of `@seampact/spec/ir`:
 * the `irVersion` values, the exact `irRevision`, and the declaration kinds and must-understand features.
 */
public data class IrSupport(
    val irVersions: List<Long>,
    val irRevision: Long,
    val kinds: List<String>,
    val features: List<String>,
) {
    public companion object {
        /** The support of this model: its own version and revision, the given kinds and features. */
        public fun ofModel(kinds: List<String>, features: List<String> = emptyList()): IrSupport =
            IrSupport(listOf(IrModelVersion.IR_VERSION), IrModelVersion.IR_REVISION, kinds, features)
    }
}

/** The codes of `checkIrSupport`, plus the one a must-act unknown gets and the one a too deeply nested document gets. */
public enum class IrRefusalCode(public val code: String) {
    VERSION_UNSUPPORTED("ir.version.unsupported"),
    REVISION_MISMATCH("ir.revision.mismatch"),
    KIND_UNSUPPORTED("ir.kind.unsupported"),
    FEATURE_UNSUPPORTED("ir.feature.unsupported"),
    SUPPORT_MALFORMED("ir.support.malformed"),
    MUST_ACT_UNKNOWN("ir.must-act.unknown"),
    NESTING_TOO_DEEP("ir.nesting.too-deep"),
}

/** One named reason to refuse an IR: [member] is a JSON Pointer, [operation] the operation id when inside one. */
public data class IrRefusal(
    val code: IrRefusalCode,
    val member: String,
    val value: String,
    val expected: List<String>,
    val operation: String?,
    val message: String,
)

private const val MAX_MESSAGE_VALUE_LENGTH = 80

/** An untrusted value cut for a message; the refusal's `value` member keeps it whole. */
internal fun inMessage(value: String): String =
    if (value.length <= MAX_MESSAGE_VALUE_LENGTH) value else value.take(MAX_MESSAGE_VALUE_LENGTH) + "..."
