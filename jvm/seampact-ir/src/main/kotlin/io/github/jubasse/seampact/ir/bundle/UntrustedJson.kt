package io.github.jubasse.seampact.ir.bundle

import io.github.jubasse.seampact.ir.model.IrJson
import io.github.jubasse.seampact.ir.read.scanText
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// A bundle's JSON comes from the network: refused when it is not UTF-8, starts with a byte order mark, nests past
// the reader's bound, holds a token JSON refuses or is not JSON, then when any key is a name that reaches a
// JavaScript prototype (every reader refuses the same manifest), before a schema or a reader sees it.

internal sealed interface UntrustedJson {
    data class Parsed(val value: JsonElement) : UntrustedJson

    /** Why the text is refused, as the end of a sentence naming the file. */
    data class Refused(val problem: String) : UntrustedJson
}

private val RESERVED_KEYS = setOf("__proto__", "constructor", "prototype")
private const val BYTE_ORDER_MARK = '﻿'

/** The UTF-8 text of [bytes], or null when they are not UTF-8. */
internal fun utf8Text(bytes: ByteArray): String? {
    val decoder = Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)

    return try {
        decoder.decode(ByteBuffer.wrap(bytes)).toString()
    } catch (_: CharacterCodingException) {
        // The caller names the file that is not UTF-8.
        null
    }
}

/** The parsed [text], or why it is refused. */
internal fun parseUntrustedJson(text: String): UntrustedJson {
    if (text.startsWith(BYTE_ORDER_MARK)) return UntrustedJson.Refused("starts with a byte order mark (U+FEFF)")

    val scan = scanText(text)
    if (scan.nestingRefusal != null) return UntrustedJson.Refused("is not readable: ${scan.nestingRefusal.message}")
    if (scan.nonJsonToken != null) return UntrustedJson.Refused("is not JSON (${quoted(scan.nonJsonToken)} is not a JSON value)")

    val value = try {
        IrJson.parseToJsonElement(text)
    } catch (error: SerializationException) {
        return UntrustedJson.Refused("is not JSON (${quoted(error.message.orEmpty())})")
    }

    val reservedAt = reservedKeyPointer(value)
    if (reservedAt != null) return UntrustedJson.Refused("holds the reserved key at ${quoted(reservedAt)}")

    return UntrustedJson.Parsed(value)
}

// Iterative: the nesting bound holds, but a wide document is walked without recursion all the same.
private fun reservedKeyPointer(root: JsonElement): String? {
    val pending = ArrayDeque<Pair<JsonElement, String>>()
    pending.addLast(root to "")

    while (pending.isNotEmpty()) {
        val (value, pointer) = pending.removeLast()
        when (value) {
            is JsonObject -> for ((key, member) in value) {
                val at = pointerBelow(pointer, key)
                if (key in RESERVED_KEYS) return at
                pending.addLast(member to at)
            }
            is JsonArray -> value.forEachIndexed { index, member -> pending.addLast(member to pointerBelow(pointer, index.toString())) }
            is JsonPrimitive -> Unit
        }
    }

    return null
}

// An open array or object of the scan: the keys seen so far (null in an array), the current key and index.
private class ScanFrame(val pointer: String, val keys: MutableSet<String>?) {
    var key: String? = null
    var index = 0

    fun childPointer(): String = pointerBelow(pointer, if (keys == null) index.toString() else key.orEmpty())
}

/**
 * The JSON Pointer of the first key given twice in one object of [text], which the parser already accepted; null
 * when every key is given once (the parser keeps the last one, so two readers would read two documents).
 */
internal fun duplicateKeyPointer(text: String): String? {
    val stack = ArrayDeque<ScanFrame>()
    var expectingKey = false
    var at = 0

    while (at < text.length) {
        val top = stack.lastOrNull()
        when (text[at]) {
            '"' -> {
                val end = stringEnd(text, at)
                val keys = top?.keys
                if (expectingKey && keys != null) {
                    val key = (IrJson.parseToJsonElement(text.substring(at, end + 1)) as JsonPrimitive).content
                    if (!keys.add(key)) return pointerBelow(top.pointer, key)
                    top.key = key
                    expectingKey = false
                }
                at = end
            }
            '{', '[' -> {
                val pointer = top?.childPointer() ?: ""
                val isObject = text[at] == '{'
                stack.addLast(ScanFrame(pointer, if (isObject) mutableSetOf() else null))
                expectingKey = isObject
            }
            '}', ']' -> stack.removeLastOrNull()
            ',' -> {
                if (top != null) top.index++
                expectingKey = top?.keys != null
            }
        }
        at++
    }

    return null
}

// The index of the quote that closes the string opened at [start].
private fun stringEnd(text: String, start: Int): Int {
    var at = start + 1
    while (at < text.length) {
        if (text[at] == '\\') at++ else if (text[at] == '"') return at
        at++
    }

    error("bundle: a JSON string the parser accepted has no closing quote.")
}
