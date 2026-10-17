package io.github.jubasse.seampact.ir.naming

private const val ESCAPE = "_"

private fun capitalized(word: String): String = word.replaceFirstChar { if (it in 'a'..'z') it.uppercaseChar() else it }

private fun joined(words: List<String>, style: NamingStyle): String = words.withIndex().joinToString("") { (index, word) ->
    when (style) {
        NamingStyle.UPPER_SNAKE -> (if (index > 0) "_" else "") + word.uppercase()
        NamingStyle.CAMEL -> if (index == 0) word else capitalized(word)
        NamingStyle.PASCAL -> capitalized(word)
    }
}

/**
 * The identifier of [name] in [language] (ADR 0007 sections 4 and 5): the segments and the suffix words joined in the
 * style of the role, a leading `_` when the first word starts with a digit, then a trailing `_` when the result is a
 * reserved word or a shadowed name.
 *
 * @throws IllegalArgumentException the name has no segment and no suffix word
 */
public fun identifier(name: IrName, language: NamingLanguage): String {
    val words = name.words()
    require(words.isNotEmpty()) { "a ${name.role.wire} name without segment has no identifier" }

    val joinedWords = joined(words, language.styleOf(name.role))
    val digitSafe = if (joinedWords.first() in '0'..'9') "_$joinedWords" else joinedWords

    return if (language.isReserved(digitSafe, name.role)) digitSafe + ESCAPE else digitSafe
}

/** The case of an operation id, `conventions.operationIds.case` (ADR 0002 section 13). */
public enum class OperationIdCase { CAMEL, SNAKE }

/**
 * The string of an operation id for [segments]: pure casing, with no reserved-word escape and no digit escape,
 * because the id is the same string in the IR, in OpenAPI and in `relays` (ADR 0007 section 3).
 *
 * @throws IllegalArgumentException no segment, or a segment outside `[a-z0-9]+`
 */
public fun operationId(segments: List<String>, idCase: OperationIdCase = OperationIdCase.CAMEL): String {
    require(segments.isNotEmpty()) { "an operation id needs at least one segment" }
    requireSegments(segments)

    return when (idCase) {
        OperationIdCase.SNAKE -> segments.joinToString("_")
        OperationIdCase.CAMEL -> joined(segments, NamingStyle.CAMEL)
    }
}
