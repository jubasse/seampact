package io.github.jubasse.seampact.ir.bundle

import io.github.jubasse.seampact.ir.read.checkMustActUnknowns
import io.github.jubasse.seampact.ir.schema.SpecSchemas
import io.github.jubasse.seampact.ir.schema.schemaResources
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// Step 3 of the pinned-bundle check validates each IR file against the open IR JSON Schema of `@seampact/spec`, as
// `ir-check.ts` does with Ajv: through the pinned JSON Schema validator, so the schema is never ported by hand.
// Ajv reads the unions' `discriminator` keyword; a plain 2020-12 validator does not, so each discriminated `oneOf`
// is computed into one `if`/`then` per known tag: a known tag validates against its variant alone, an unknown tag
// against none, as the open form accepts it. An unknown tag or value of a must-act union or enum is then refused,
// as the open form refuses it (ADR 0005 section 3), from the must-act walk the reader already runs.

private const val IR_SCHEMA_RESOURCES = "io/github/jubasse/seampact/ir/bundle/ir-schema"
private const val IR_SCHEMA_IDS = "https://seampact.dev/schemas/ir"
private const val IR_SCHEMA = "ir.schema.json"
private val IR_SCHEMA_FILES = listOf(
    "common.schema.json",
    "declarations.schema.json",
    "formats.schema.json",
    IR_SCHEMA,
    "operation.schema.json",
    "schemas.schema.json",
    "source-map.schema.json",
)
private const val LISTED_PROBLEM_LIMIT = 5

private val OPEN_IR_SCHEMAS by lazy {
    val texts = schemaResources(IR_SCHEMA_RESOURCES, IR_SCHEMA_FILES)
        .mapValues { (fileName, text) -> withDiscriminatorsAsConditions(fileName, Json.parseToJsonElement(text)).toString() }

    SpecSchemas(IR_SCHEMA_IDS, texts)
}

/** The problems of [document] under the open IR JSON Schema, as `ir-check.ts` lists them; empty when it is valid. */
internal fun irSchemaProblems(document: JsonElement): List<String> {
    val schemaProblems = OPEN_IR_SCHEMAS.validate(IR_SCHEMA, document).map { violation ->
        "at ${quoted(pointerOf(violation.instancePath))} ${quoted(violation.message)}"
    }
    val mustActProblems = checkMustActUnknowns(document).map { refusal ->
        "at ${quoted(refusal.member)} an unknown ${quoted(refusal.value)}"
    }

    return schemaProblems + mustActProblems
}

/** The `bundle.ir-invalid` message of [problems]: the first ones, then how many more. */
internal fun irSchemaMessage(file: String, problems: List<String>): String {
    val listed = problems.take(LISTED_PROBLEM_LIMIT)
    val more = problems.size - listed.size
    val tail = if (more > 0) "; and $more more" else ""

    return "'$file' is not valid under the IR JSON Schema: ${listed.joinToString("; ")}$tail."
}

private fun pointerOf(path: List<Any>): String =
    path.joinToString("") { "/" + it.toString().replace("~", "~0").replace("/", "~1") }

// Every `{ discriminator, oneOf }` node of the file, rewritten as `allOf` of one `if`/`then` per variant.
private fun withDiscriminatorsAsConditions(fileName: String, schema: JsonElement): JsonElement {
    val definitions = schema.jsonObject["\$defs"]?.jsonObject ?: JsonObject(emptyMap())

    fun rewrite(node: JsonElement): JsonElement = when (node) {
        is JsonArray -> JsonArray(node.map(::rewrite))
        is JsonObject -> {
            val members = node.mapValues { (_, value) -> rewrite(value) }
            if ("discriminator" in node && "oneOf" in node) asConditions(fileName, JsonObject(members), definitions) else JsonObject(members)
        }
        else -> node
    }

    return rewrite(schema)
}

private fun asConditions(fileName: String, union: JsonObject, definitions: JsonObject): JsonObject {
    val tagMember = union.getValue("discriminator").jsonObject.getValue("propertyName").jsonPrimitive.content
    val variants = union.getValue("oneOf").jsonArray

    val conditions = variants.map { variant ->
        val reference = variant.jsonObject.getValue("\$ref").jsonPrimitive.content
        val definition = definitions[reference.removePrefix("#/\$defs/")]?.jsonObject
        val tag = definition?.get("properties")?.jsonObject?.get(tagMember)?.jsonObject?.get("const")
            ?: error("seampact-ir: the IR schema $fileName variant $reference has no const '$tagMember'; the union rewrite does not know it.")

        JsonObject(
            mapOf(
                "if" to JsonObject(
                    mapOf(
                        "properties" to JsonObject(mapOf(tagMember to JsonObject(mapOf("const" to tag)))),
                        "required" to JsonArray(listOf(JsonPrimitive(tagMember))),
                    ),
                ),
                "then" to variant,
            ),
        )
    }

    return JsonObject(union - "discriminator" - "oneOf" + ("allOf" to JsonArray(conditions)))
}
