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

/**
 * The codes of `checkIrSupport`, then two codes local to the native readers: an unknown tag or value of a
 * must-act definition, and a document nested past the depth they read.
 */
public enum class IrRefusalCode(public val code: String) {
    VERSION_UNSUPPORTED("ir.version.unsupported"),
    REVISION_MISMATCH("ir.revision.mismatch"),
    KIND_UNSUPPORTED("ir.kind.unsupported"),
    FEATURE_UNSUPPORTED("ir.feature.unsupported"),
    SUPPORT_MALFORMED("ir.support.malformed"),
    MUST_ACT_UNKNOWN("ir.must-act.unknown"),
    NESTING_TOO_DEEP("ir.nesting.too-deep"),
}

/**
 * One named reason to refuse an IR. [member] is the JSON Pointer of the refused value. [operation] is the id of
 * the operation it is in, null outside one and for `ir.nesting.too-deep`, which refuses before reading anything.
 * [value] and [expected] by code:
 * - version, revision, kind, feature and must-act: [value] is the refused value (a string as is, a number in
 *   plain form when short, an array or object by its JSON type, an absent one `missing`), [expected] the values
 *   the reader accepts.
 * - `ir.support.malformed`: [value] is the JSON type found, [expected] is `array`.
 * - `ir.nesting.too-deep`: [value] is the depth reached, the bound plus one; [expected] is the bound. [member] is
 *   the first array or object past the bound in document order.
 * [message] cuts every untrusted string; the other members keep it whole.
 */
public data class IrRefusal(
    val code: IrRefusalCode,
    val member: String,
    val value: String,
    val expected: List<String>,
    val operation: String?,
    val message: String,
)
