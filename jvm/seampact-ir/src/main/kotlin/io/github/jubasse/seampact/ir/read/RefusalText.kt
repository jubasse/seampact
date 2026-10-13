package io.github.jubasse.seampact.ir.read

private const val MAX_MESSAGE_VALUE_LENGTH = 80

// Each check stops after this many refusals: a pointer repeats every map key above it, so an unbounded list of
// refusals under a long key would copy that key without bound.
internal const val MAX_REFUSALS = 100

/** An untrusted string cut for a message; the refusal's other members keep it whole. */
internal fun inMessage(value: String): String =
    if (value.length <= MAX_MESSAGE_VALUE_LENGTH) value else value.take(MAX_MESSAGE_VALUE_LENGTH) + "..."

/** A member name as one JSON Pointer segment (RFC 6901). */
internal fun escapePointerSegment(member: String): String = member.replace("~", "~0").replace("/", "~1")
