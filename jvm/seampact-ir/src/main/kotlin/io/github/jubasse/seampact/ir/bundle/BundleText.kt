package io.github.jubasse.seampact.ir.bundle

import io.github.jubasse.seampact.ir.read.escapePointerSegment

// Untrusted text in a bundle message, as the compiler's `quote` prints it: in single quotes, at most 80 code
// points, the C0, DEL and C1 controls, the bidi controls and the line and paragraph separators as \uXXXX.

private const val QUOTE_LIMIT = 80

private fun isUnsafe(codePoint: Int): Boolean =
    codePoint <= 0x1f ||
        codePoint in 0x7f..0x9f ||
        codePoint == 0x061c ||
        codePoint == 0x200e ||
        codePoint == 0x200f ||
        codePoint in 0x202a..0x202e ||
        codePoint in 0x2066..0x2069 ||
        codePoint == 0x2028 ||
        codePoint == 0x2029

/** [value] quoted for a message. */
internal fun quoted(value: String): String {
    val codePoints = value.codePoints().toArray()
    val kept = codePoints.take(QUOTE_LIMIT)
    val shown = buildString {
        for (codePoint in kept) {
            if (isUnsafe(codePoint)) append("\\u").append(codePoint.toString(16).uppercase().padStart(4, '0'))
            else appendCodePoint(codePoint)
        }
        if (codePoints.size > QUOTE_LIMIT) append('…')
    }

    return "'$shown'"
}

/** The JSON Pointer of [member] below [pointer]. */
internal fun pointerBelow(pointer: String, member: String): String = "$pointer/${escapePointerSegment(member)}"

/** At most [limit] problems joined, then how many more there are. */
internal fun listedProblems(problems: List<String>, limit: Int): String {
    val more = problems.size - limit
    val listed = problems.take(limit).joinToString("; ")

    return if (more > 0) "$listed; and $more more" else listed
}
