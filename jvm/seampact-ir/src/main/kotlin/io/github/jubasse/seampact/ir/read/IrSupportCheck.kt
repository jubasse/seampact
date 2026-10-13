package io.github.jubasse.seampact.ir.read

import java.math.BigDecimal
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private const val MISSING = "missing"

/** The package a refused version or revision tells the reader to update. */
internal const val IR_PACKAGE = "io.github.jubasse:seampact-ir"

/**
 * Returns one named refusal per unsupported `irVersion`, different `irRevision`, unknown kind or unknown
 * feature, top level and per operation (the port of `checkIrSupport`). An unsupported `irVersion` is returned
 * alone: the rest of the document may have another shape. A list that is missing or not an array is named
 * (`ir.support.malformed`), never read as empty. Reads the document as untrusted data and never throws.
 */
internal fun checkIrSupport(ir: JsonElement, support: IrSupport): List<IrRefusal> {
    val document = ir as? JsonObject ?: JsonObject(emptyMap())
    val version = document["irVersion"]
    val versionNumber = numberOf(version)
    if (versionNumber == null || support.irVersions.none { BigDecimal(it).compareTo(versionNumber) == 0 }) {
        val expected = support.irVersions.map { it.toString() }
        return listOf(
            IrRefusal(
                IrRefusalCode.VERSION_UNSUPPORTED,
                "/irVersion",
                shown(version),
                expected,
                null,
                "irVersion ${shown(version)} is not one this reader reads (${expected.joinToString(", ")}). " +
                    "Update the $IR_PACKAGE package to one that reads it.",
            ),
        )
    }

    val refusals = mutableListOf<IrRefusal>()
    val revision = document["irRevision"]
    if (numberOf(revision)?.compareTo(BigDecimal(support.irRevision)) != 0) {
        refusals += IrRefusal(
            IrRefusalCode.REVISION_MISMATCH,
            "/irRevision",
            shown(revision),
            listOf(support.irRevision.toString()),
            null,
            "irRevision ${shown(revision)} differs from the revision this reader was built for " +
                "(${support.irRevision}). Update the $IR_PACKAGE package to the revision of the compiler.",
        )
    }

    fun list(value: JsonElement?, member: String, operation: String? = null): List<JsonElement>? {
        if (value is JsonArray) return value
        refusals += IrRefusal(
            IrRefusalCode.SUPPORT_MALFORMED,
            member,
            jsonType(value),
            listOf("array"),
            operation,
            "$member is ${jsonType(value)}, not an array: this reader cannot check what it supports.",
        )
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
        values.orEmpty().forEachIndexed { index, value ->
            if (isStringIn(value, known)) return@forEachIndexed
            val where = if (operation == null) "" else " in operation '$operation'"
            refusals += IrRefusal(
                code,
                "$member/$index",
                shown(value),
                known,
                operation,
                "The $what '${shown(value)}'$where is not supported by this reader.",
            )
        }
    }

    unknownIn(list(document["kinds"], "/kinds"), support.kinds, IrRefusalCode.KIND_UNSUPPORTED, "/kinds")
    unknownIn(list(document["features"], "/features"), support.features, IrRefusalCode.FEATURE_UNSUPPORTED, "/features")

    list(document["operations"], "/operations").orEmpty().forEachIndexed { index, entry ->
        val operation = entry as? JsonObject ?: JsonObject(emptyMap())
        val id = (operation["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: "#$index"
        val kind = operation["kind"]
        if (!isStringIn(kind, support.kinds)) {
            refusals += IrRefusal(
                IrRefusalCode.KIND_UNSUPPORTED,
                "/operations/$index/kind",
                shown(kind),
                support.kinds,
                id,
                "The declaration kind '${shown(kind)}' of operation '$id' is not supported by this reader.",
            )
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
    (value as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toBigDecimalOrNull()

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

// A string or a number as written (a number without a trailing fraction of zeros), any other value as JSON.
private fun shown(value: JsonElement?): String {
    if (value == null) return MISSING
    val number = numberOf(value)
    return when {
        value is JsonPrimitive && value.isString -> value.content
        number != null -> number.stripTrailingZeros().toPlainString()
        else -> value.toString()
    }
}
