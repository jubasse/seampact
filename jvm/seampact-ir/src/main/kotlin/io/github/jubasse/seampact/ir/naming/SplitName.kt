package io.github.jubasse.seampact.ir.naming

private enum class CharKind { OTHER, LOWER, UPPER, DIGIT }

private fun kindOf(character: Char): CharKind = when (character) {
    in 'a'..'z' -> CharKind.LOWER
    in 'A'..'Z' -> CharKind.UPPER
    in '0'..'9' -> CharKind.DIGIT
    else -> CharKind.OTHER
}

/**
 * Splits a written name with the four rules of ADR 0007 section 2. Total: any string gives a possibly empty list of
 * non-empty `[a-z0-9]+` segments. Only ASCII is looked at, so the result never depends on a locale.
 */
public fun splitName(written: String): List<String> {
    val segments = mutableListOf<String>()
    var start = -1

    for (index in written.indices) {
        val kind = kindOf(written[index])

        if (kind == CharKind.OTHER) {
            if (start >= 0) segments += written.substring(start, index).lowercase()
            start = -1
            continue
        }

        if (start < 0) {
            start = index
            continue
        }

        if (kind != CharKind.UPPER) continue
        val previous = kindOf(written[index - 1])
        val next = if (index + 1 < written.length) kindOf(written[index + 1]) else CharKind.OTHER

        // An uppercase letter after a lowercase letter or a digit starts a segment; so does one that ends an
        // uppercase run and is followed by a lowercase letter (`HTTPServer`).
        if (previous == CharKind.LOWER || previous == CharKind.DIGIT || (previous == CharKind.UPPER && next == CharKind.LOWER)) {
            segments += written.substring(start, index).lowercase()
            start = index
        }
    }

    if (start >= 0) segments += written.substring(start).lowercase()

    return segments
}

/** Where a written name comes from; it decides what a name without any segment means. */
public enum class NameSource { NAME, ENUM_VALUE, RIGHT }

/**
 * The segments of a written name in its context (ADR 0007 section 2, last paragraph), or null when it has none
 * (`no-segment`): a [codeName] replaces the split of [written] and never falls back; an enum value without a segment
 * becomes `value<position>`, [position] being one-based and required for an enum value.
 *
 * @throws IllegalArgumentException an enum value without a positive [position]
 */
public fun segmentsOf(written: String, source: NameSource, codeName: String? = null, position: Int? = null): List<String>? {
    require(source != NameSource.ENUM_VALUE || (position != null && position >= 1)) {
        "an enum value needs its one-based position, got $position"
    }

    val split = splitName(codeName ?: written)

    if (split.isNotEmpty()) return split
    if (source == NameSource.ENUM_VALUE && codeName == null) return listOf("value$position")

    return null
}
