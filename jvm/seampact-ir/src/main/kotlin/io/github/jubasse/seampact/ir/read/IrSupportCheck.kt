package io.github.jubasse.seampact.ir.read

import io.github.jubasse.seampact.ir.model.IR_NUMBER_LITERAL_MAX_LENGTH
import java.math.BigDecimal
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private const val MISSING = "missing"

// A number is rendered in plain form only when its integer digits and its scale are each at most this many;
// any other is shown as written.
private const val MAX_PLAIN_DIGITS = 64

// A literal longer than IR_NUMBER_LITERAL_MAX_LENGTH is never read as a number. This fails closed where
// TypeScript reads `1.000...0` written with 72 chars as 1; the native readers refuse it on purpose.

/** The package a refused version or revision tells the reader to update. */
internal const val IR_PACKAGE = "io.github.jubasse:seampact-ir"

/**
 * Returns one named refusal per unsupported `irVersion`, different `irRevision`, unknown kind or unknown
 * feature, top level and per operation (the port of `checkIrSupport`). An unsupported `irVersion` is returned
 * alone: the rest of the document may have another shape. A list that is missing or not an array is named
 * (`ir.support.malformed`), never read as empty. Stops after [MAX_REFUSALS]. Reads the document as untrusted
 * data and never throws.
 */
internal fun checkIrSupport(ir: JsonElement, support: IrSupport): List<IrRefusal> {
    val document = ir as? JsonObject ?: JsonObject(emptyMap())
    val version = document["irVersion"]
    val versionNumber = numberOf(version)
    val versionIsSupported =
        versionNumber != null && support.irVersions.any { BigDecimal(it).compareTo(versionNumber) == 0 }
    if (!versionIsSupported) {
        val expected = support.irVersions.map { it.toString() }
        return listOf(
            IrRefusal(
                IrRefusalCode.VERSION_UNSUPPORTED,
                "/irVersion",
                shown(version),
                expected,
                null,
                "irVersion ${inMessage(shown(version))} is not one this reader reads " +
                    "(${expected.joinToString(", ")}). Update the $IR_PACKAGE package to one that reads it.",
            ),
        )
    }

    val refusals = mutableListOf<IrRefusal>()
    fun isFull(): Boolean = refusals.size >= MAX_REFUSALS

    fun refuse(refusal: IrRefusal) {
        if (!isFull()) refusals += refusal
    }

    val revision = document["irRevision"]
    if (numberOf(revision)?.compareTo(BigDecimal(support.irRevision)) != 0) {
        refuse(IrRefusal(
            IrRefusalCode.REVISION_MISMATCH,
            "/irRevision",
            shown(revision),
            listOf(support.irRevision.toString()),
            null,
            "irRevision ${inMessage(shown(revision))} differs from the revision this reader was built for " +
                "(${support.irRevision}). Update the $IR_PACKAGE package to the revision of the compiler.",
        ))
    }

    fun list(value: JsonElement?, member: String, operation: String? = null): List<JsonElement>? {
        if (value is JsonArray) return value
        refuse(IrRefusal(
            IrRefusalCode.SUPPORT_MALFORMED,
            member,
            jsonType(value),
            listOf("array"),
            operation,
            "$member is ${jsonType(value)}, not an array: this reader cannot check what it supports.",
        ))
        return null
    }

    fun unknownIn(
        values: List<JsonElement>?,
        known: List<String>,
        code: IrRefusalCode,
        member: String,
        operation: String? = null,
    ) {
        val what = if (code == IrRefusalCode.KIND_UNSUPPORTED) "declaration kind" else "feature"
        for ((index, value) in values.orEmpty().withIndex()) {
            if (isFull()) return
            if (isStringIn(value, known)) continue
            val where = if (operation == null) "" else " in operation '${inMessage(operation)}'"
            refuse(IrRefusal(
                code,
                "$member/$index",
                shown(value),
                known,
                operation,
                "The $what '${inMessage(shown(value))}'$where is not supported by this reader.",
            ))
        }
    }

    unknownIn(list(document["kinds"], "/kinds"), support.kinds, IrRefusalCode.KIND_UNSUPPORTED, "/kinds")
    val features = list(document["features"], "/features")
    unknownIn(features, support.features, IrRefusalCode.FEATURE_UNSUPPORTED, "/features")

    for ((index, entry) in list(document["operations"], "/operations").orEmpty().withIndex()) {
        if (isFull()) break
        val operation = entry as? JsonObject ?: JsonObject(emptyMap())
        val id = (operation["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: "#$index"
        val kind = operation["kind"]
        if (!isStringIn(kind, support.kinds)) {
            refuse(IrRefusal(
                IrRefusalCode.KIND_UNSUPPORTED,
                "/operations/$index/kind",
                shown(kind),
                support.kinds,
                id,
                "The declaration kind '${inMessage(shown(kind))}' of operation '${inMessage(id)}' " +
                    "is not supported by this reader.",
            ))
        }
        val member = "/operations/$index/features"
        unknownIn(
            list(operation["features"], member, id),
            support.features,
            IrRefusalCode.FEATURE_UNSUPPORTED,
            member,
            id,
        )
    }
    return refusals
}

private fun isStringIn(value: JsonElement?, known: List<String>): Boolean =
    value is JsonPrimitive && value.isString && value.content in known

private fun numberOf(value: JsonElement?): BigDecimal? =
    (value as? JsonPrimitive)
        ?.takeIf { !it.isString && it.content.length <= IR_NUMBER_LITERAL_MAX_LENGTH }
        ?.content
        ?.toBigDecimalOrNull()

private fun jsonType(value: JsonElement?): String = when (value) {
    null -> MISSING
    JsonNull -> "null"
    is JsonArray -> "array"
    is JsonObject -> "object"
    is JsonPrimitive -> when {
        value.isString -> "string"
        value.content == "true" || value.content == "false" -> "boolean"
        else -> "number"
    }
}

// A string as is, a number without a trailing fraction of zeros (as written when its plain form is long:
// 1e2147483647 would not fit in memory), `true`, `false` or `null`, and an array or object by its JSON type:
// rendering a container would copy any amount of untrusted input into every refusal.
private fun shown(value: JsonElement?): String {
    if (value !is JsonPrimitive) return jsonType(value)
    val number = numberOf(value)
    return when {
        value.isString -> value.content
        number != null && hasShortPlainForm(number) -> number.stripTrailingZeros().toPlainString()
        else -> value.content
    }
}

private fun hasShortPlainForm(number: BigDecimal): Boolean {
    val integerDigits = number.precision().toLong() - number.scale()

    return integerDigits <= MAX_PLAIN_DIGITS && number.scale() <= MAX_PLAIN_DIGITS
}
