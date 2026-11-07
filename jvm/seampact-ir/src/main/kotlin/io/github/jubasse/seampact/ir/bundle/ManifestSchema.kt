package io.github.jubasse.seampact.ir.bundle

import io.github.jubasse.seampact.ir.model.IrJson
import io.github.jubasse.seampact.ir.model.irNumberOf
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// The manifest's JSON Schema, `packages/core/spec/schemas/bundle/manifest.schema.json`, copied into the jar at build
// time, and the checks of the keywords it uses: the schema stays the one source of the shape, its patterns and
// caps. A keyword this file does not check fails the first read by name, so a schema change is never half read.

private const val SCHEMA_RESOURCE = "manifest.schema.json"

// Keywords that only describe.
private val ANNOTATIONS = setOf("\$schema", "\$id", "\$defs", "title", "description")
private val CHECKED_KEYWORDS = setOf(
    "type", "const", "required", "properties", "additionalProperties", "items", "minItems", "minLength",
    "maxLength", "pattern", "minimum", "\$ref", "not",
)
private const val LOCAL_REFERENCE_PREFIX = "#/\$defs/"

internal object ManifestSchema {
    private val root: JsonObject by lazy { loadSchema() }
    private val patterns = HashMap<String, Regex>()

    /** The schema's `$defs/path`, the one source of the portable-path rule. */
    val pathDefinition: JsonObject get() = definition("path")

    /** Every problem of [instance] under the schema, as `at '<pointer>' <problem>`. */
    fun problems(instance: JsonElement): List<String> {
        val problems = mutableListOf<String>()
        check(root, instance, "", problems)

        return problems
    }

    /** Whether [value] matches the schema pattern [pattern] as ECMAScript reads it. */
    @Synchronized
    fun matches(pattern: String, value: String): Boolean =
        patterns.getOrPut(pattern) { Regex(ecmaScriptPattern(pattern)) }.containsMatchIn(value)

    private fun definition(name: String): JsonObject =
        root["\$defs"]?.jsonObject?.get(name)?.jsonObject
            ?: error("bundle: the manifest schema has no \$defs/$name.")

    private fun loadSchema(): JsonObject {
        val stream = ManifestSchema::class.java.getResourceAsStream(SCHEMA_RESOURCE)
            ?: error("bundle: the jar holds no $SCHEMA_RESOURCE beside ${ManifestSchema::class.java.name}; rebuild seampact-ir.")
        val schema = stream.use { IrJson.parseToJsonElement(it.readBytes().decodeToString()) }.jsonObject
        refuseUnknownKeywords(schema, "")

        return schema
    }

    private fun refuseUnknownKeywords(schema: JsonObject, pointer: String) {
        for ((keyword, value) in schema) {
            if (keyword !in ANNOTATIONS && keyword !in CHECKED_KEYWORDS) {
                error("bundle: the manifest schema uses '$keyword' at '$pointer', which this reader does not check.")
            }
            when (keyword) {
                "properties", "\$defs" -> value.jsonObject.forEach { (name, child) ->
                    refuseUnknownKeywords(child.jsonObject, "$pointer/$keyword/$name")
                }
                "items", "not" -> refuseUnknownKeywords(value.jsonObject, "$pointer/$keyword")
                "additionalProperties" -> require(value == JsonPrimitive(false)) {
                    "bundle: the manifest schema's additionalProperties at '$pointer' is not false."
                }
            }
        }
    }

    private fun check(schema: JsonObject, instance: JsonElement, pointer: String, problems: MutableList<String>) {
        val reference = schema["\$ref"]?.jsonPrimitive?.content
        if (reference != null) {
            require(reference.startsWith(LOCAL_REFERENCE_PREFIX)) { "bundle: the manifest schema reference '$reference' is not local." }
            check(definition(reference.removePrefix(LOCAL_REFERENCE_PREFIX)), instance, pointer, problems)
        }

        val type = schema["type"]?.jsonPrimitive?.content
        if (type != null && !hasType(instance, type)) {
            problems += "at ${quoted(pointer)} must be $type"
            return
        }

        val constant = schema["const"]
        if (constant != null && !sameValue(constant, instance)) problems += "at ${quoted(pointer)} must be equal to constant"

        when (instance) {
            is JsonObject -> checkObject(schema, instance, pointer, problems)
            is JsonArray -> checkArray(schema, instance, pointer, problems)
            is JsonPrimitive -> checkScalar(schema, instance, pointer, problems)
        }

        val negated = schema["not"]?.jsonObject
        if (negated != null && problemsUnder(negated, instance, pointer).isEmpty()) {
            problems += "at ${quoted(pointer)} must NOT be valid"
        }
    }

    private fun problemsUnder(schema: JsonObject, instance: JsonElement, pointer: String): List<String> {
        val problems = mutableListOf<String>()
        check(schema, instance, pointer, problems)

        return problems
    }

    private fun checkObject(schema: JsonObject, instance: JsonObject, pointer: String, problems: MutableList<String>) {
        val properties = schema["properties"]?.jsonObject ?: JsonObject(emptyMap())

        schema["required"]?.jsonArray?.forEach { name ->
            if (name.jsonPrimitive.content !in instance) {
                problems += "at ${quoted(pointer)} must have required property ${quoted(name.jsonPrimitive.content)}"
            }
        }

        for ((name, member) in instance) {
            val memberSchema = properties[name]?.jsonObject
            if (memberSchema != null) {
                check(memberSchema, member, pointerBelow(pointer, name), problems)
            } else if ("additionalProperties" in schema) {
                problems += "at ${quoted(pointer)} must NOT have additional properties (${quoted(name)})"
            }
        }
    }

    private fun checkArray(schema: JsonObject, instance: JsonArray, pointer: String, problems: MutableList<String>) {
        val minItems = schema["minItems"]?.jsonPrimitive?.content?.toInt()
        if (minItems != null && instance.size < minItems) problems += "at ${quoted(pointer)} must NOT have fewer than $minItems items"

        val items = schema["items"]?.jsonObject ?: return
        instance.forEachIndexed { index, item -> check(items, item, pointerBelow(pointer, index.toString()), problems) }
    }

    private fun checkScalar(schema: JsonObject, instance: JsonPrimitive, pointer: String, problems: MutableList<String>) {
        if (instance.isString) {
            val length = instance.content.codePointCount(0, instance.content.length)
            val minLength = schema["minLength"]?.jsonPrimitive?.content?.toInt()
            val maxLength = schema["maxLength"]?.jsonPrimitive?.content?.toInt()
            val pattern = schema["pattern"]?.jsonPrimitive?.content

            if (minLength != null && length < minLength) problems += "at ${quoted(pointer)} must NOT have fewer than $minLength characters"
            if (maxLength != null && length > maxLength) problems += "at ${quoted(pointer)} must NOT have more than $maxLength characters"
            if (pattern != null && !matches(pattern, instance.content)) problems += "at ${quoted(pointer)} must match pattern ${quoted(pattern)}"
            return
        }

        val minimum = schema["minimum"]?.jsonPrimitive?.content?.let(::irNumberOf)
        val number = irNumberOf(instance.content)
        if (minimum != null && number != null && number < minimum) problems += "at ${quoted(pointer)} must be >= ${schema["minimum"]}"
    }

    private fun hasType(instance: JsonElement, type: String): Boolean = when (type) {
        "object" -> instance is JsonObject
        "array" -> instance is JsonArray
        "string" -> instance is JsonPrimitive && instance.isString
        "integer" -> instance is JsonPrimitive && !instance.isString && irNumberOf(instance.content)?.let { it % 1.0 == 0.0 } == true
        else -> error("bundle: the manifest schema uses the type '$type', which this reader does not check.")
    }

    // JSON Schema equality: numbers by value, so `1.0` equals `1`.
    private fun sameValue(constant: JsonElement, instance: JsonElement): Boolean {
        if (constant !is JsonPrimitive || instance !is JsonPrimitive || instance is JsonNull) return constant == instance
        if (constant.isString || instance.isString) return constant == instance

        val constantNumber = irNumberOf(constant.content)

        return constantNumber != null && constantNumber == irNumberOf(instance.content)
    }
}

// An ECMAScript pattern without the `m` flag ends only at the end of the input; Java's `$` also matches before a
// final line break, so every `$` outside a character class becomes `\z`.
private fun ecmaScriptPattern(pattern: String): String = buildString {
    var inClass = false
    var escaped = false
    for (character in pattern) {
        when {
            escaped -> { append(character); escaped = false }
            character == '\\' -> { append(character); escaped = true }
            character == '[' -> { append(character); inClass = true }
            character == ']' -> { append(character); inClass = false }
            character == '$' && !inClass -> append("\\z")
            else -> append(character)
        }
    }
}
