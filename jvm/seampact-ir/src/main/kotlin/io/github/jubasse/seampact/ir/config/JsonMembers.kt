package io.github.jubasse.seampact.ir.config

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Typed reads of a schema-checked config value: the schema already fixed each member's type.

internal fun JsonElement.stringValue(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

internal fun JsonObject.stringAt(key: String): String? = this[key]?.stringValue()

internal fun JsonObject.stringsAt(key: String): List<String>? = (this[key] as? JsonArray)?.mapNotNull { it.stringValue() }

internal fun JsonObject.booleanAt(key: String): Boolean? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toBooleanStrictOrNull()

/** A member the schema requires. */
internal fun JsonObject.requiredStringAt(key: String): String =
    stringAt(key) ?: error("config: the schema-checked value has no string '$key'.")
