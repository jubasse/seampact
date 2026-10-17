package io.github.jubasse.seampact.ir.read

import io.github.jubasse.seampact.ir.model.isJsonNumber
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// The deepest JSON nesting a reader reads, counted as PHP's `json_decode` depth counts it: each array or object
// is one level, the root one is level 1. The deepest real IR is a few dozen levels. The parse, the checks and the
// decode that follow recurse per level, so the whole document is measured first, without recursion.
internal const val MAX_NESTING_DEPTH = 256

// The bare words of JSON; any other bare token outside strings is a number or not JSON.
private val JSON_WORDS = setOf("true", "false", "null")

// The characters that end a bare token: JSON whitespace, the structural characters and the string quote.
private const val TOKEN_ENDS = " \t\n\r{}[]:,\""

/** What one scan of a JSON text found before it is parsed: the nesting refusal, or the first token that is not JSON. */
internal class TextScan(val nestingRefusal: IrRefusal?, val nonJsonToken: String?)

/**
 * One linear scan of a JSON text, before it is parsed. It counts the arrays and objects open outside strings and
 * stops at the first one past [MAX_NESTING_DEPTH]. It counts every array and object as written, a duplicate key's
 * included, so a text too deep is refused even when it is also malformed or when the parser would drop the
 * duplicate. Under the bound, it also finds the first bare token that is not `true`, `false`, `null` or a JSON
 * number: the platform parser reads such a token (`3d`, `NaN`, `foo`) as a literal, where JSON refuses it. Any
 * other malformed text is left to the parser.
 */
internal fun scanText(text: String): TextScan {
    val scan = TextNestingScan(text)
    val pointerPastBound = scan.firstPointerPastBound()
    if (pointerPastBound != null) return TextScan(nestingRefusal(pointerPastBound), null)

    return TextScan(null, scan.firstNonJsonToken)
}

/** The same check on a document already parsed, by an explicit stack instead of recursion. */
internal fun checkElementNesting(document: JsonElement): IrRefusal? =
    firstElementPastBound(document)?.let(::nestingRefusal)

private fun nestingRefusal(pointer: String): IrRefusal {
    val reached = MAX_NESTING_DEPTH + 1

    return IrRefusal(
        IrRefusalCode.NESTING_TOO_DEEP,
        pointer,
        reached.toString(),
        listOf(MAX_NESTING_DEPTH.toString()),
        null,
        "The IR nests $reached levels deep at ${inMessage(pointer)}, past the $MAX_NESTING_DEPTH this reader reads: " +
            "it refuses the whole document rather than overflow its stack.",
    )
}

// An open array or object of the text, with the member or index the scan is in.
private class OpenContainer(val isObject: Boolean) {
    var key: String = ""
    var index: Int = 0

    val segment: String get() = if (isObject) key else index.toString()
}

private class TextNestingScan(private val text: String) {
    private val open = ArrayDeque<OpenContainer>()
    private var position = 0

    // In an object, the next string is a key after `{` or `,`, and a value after `:`.
    private var expectingKey = false

    var firstNonJsonToken: String? = null
        private set

    fun firstPointerPastBound(): String? {
        while (position < text.length) {
            val char = text[position++]
            when (char) {
                '{', '[' -> {
                    if (open.size == MAX_NESTING_DEPTH) return pointerOf(open.map { it.segment })
                    open.addLast(OpenContainer(isObject = char == '{'))
                    expectingKey = char == '{'
                }
                '}', ']' -> {
                    open.removeLastOrNull()
                    expectingKey = false
                }
                ',' -> nextMember()
                ':' -> expectingKey = false
                '"' -> readString()
                ' ', '\t', '\n', '\r' -> Unit
                else -> readBareToken()
            }
        }
        return null
    }

    private fun nextMember() {
        val container = open.lastOrNull() ?: return
        if (container.isObject) expectingKey = true else container.index += 1
    }

    // A number or a bare word, from the character just read to the next one that ends a token.
    private fun readBareToken() {
        val start = position - 1
        while (position < text.length && text[position] !in TOKEN_ENDS) position++
        expectingKey = false

        val token = text.substring(start, position)
        if (firstNonJsonToken == null && token !in JSON_WORDS && !isJsonNumber(token)) firstNonJsonToken = token
    }

    // Only a key is kept, decoded, for the pointer; any other string is skipped.
    private fun readString() {
        val container = open.lastOrNull()
        val key = if (expectingKey && container != null && container.isObject) StringBuilder() else null
        expectingKey = false

        while (position < text.length) {
            val char = text[position++]
            if (char == '"') break
            if (char == '\\') readEscape(key) else key?.append(char)
        }
        if (container != null && key != null) container.key = key.toString()
    }

    private fun readEscape(key: StringBuilder?) {
        if (position >= text.length) return
        val escaped = text[position++]
        if (key == null) return

        if (escaped == 'u') {
            val digits = text.substring(position, minOf(position + UNICODE_ESCAPE_DIGITS, text.length))
            if (digits.length < UNICODE_ESCAPE_DIGITS || !digits.all { it in HEX_DIGITS }) {
                key.append(escaped)
                return
            }
            key.append(digits.toInt(HEX).toChar())
            position += UNICODE_ESCAPE_DIGITS
            return
        }
        key.append(SIMPLE_ESCAPES[escaped] ?: escaped)
    }
}

private const val UNICODE_ESCAPE_DIGITS = 4
private const val HEX = 16
private const val HEX_DIGITS = "0123456789abcdefABCDEF"

private val SIMPLE_ESCAPES = mapOf('b' to '\b', 'f' to '\u000C', 'n' to '\n', 'r' to '\r', 't' to '\t')

// An open array or object of the document, with its children left to visit and the one being visited.
private class OpenElement(val children: Iterator<Pair<String, JsonElement>>) {
    var segment: String = ""
}

// Visits the containers depth first in document order, as the text scan meets them.
private fun firstElementPastBound(document: JsonElement): String? {
    val open = ArrayDeque<OpenElement>()
    open.addLast(OpenElement(childrenOf(document) ?: return null))

    while (open.isNotEmpty()) {
        val container = open.last()
        if (!container.children.hasNext()) {
            open.removeLast()
            continue
        }

        val (segment, child) = container.children.next()
        container.segment = segment
        val grandchildren = childrenOf(child) ?: continue
        if (open.size == MAX_NESTING_DEPTH) return pointerOf(open.map { it.segment })
        open.addLast(OpenElement(grandchildren))
    }
    return null
}

private fun childrenOf(element: JsonElement): Iterator<Pair<String, JsonElement>>? = when (element) {
    is JsonObject -> element.entries.asSequence().map { (key, value) -> key to value }.iterator()
    is JsonArray -> element.asSequence().mapIndexed { index, item -> index.toString() to item }.iterator()
    else -> null
}

private fun pointerOf(segments: List<String>): String = segments.joinToString("") { "/" + escapePointerSegment(it) }
