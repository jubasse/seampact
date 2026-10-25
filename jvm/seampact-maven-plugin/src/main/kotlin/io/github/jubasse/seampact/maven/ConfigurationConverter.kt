package io.github.jubasse.seampact.maven

import io.github.jubasse.seampact.ir.config.ConfigProblem
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.codehaus.plexus.configuration.PlexusConfiguration
import java.math.BigDecimal

/** The `<configuration>` app-config keys as the JSON tree the app config reader takes, or why they do not convert. */
internal sealed interface ConversionOutcome {
    data class Converted(val tree: JsonObject) : ConversionOutcome

    data class Refused(val problems: List<ConfigProblem>) : ConversionOutcome
}

/**
 * Converts the app-config elements of the plugin's `<configuration>` into the JSON tree a `seampact.config.yaml`
 * gives (A42), with the JSON types `app.schema.json` gives each key: XML holds only text, so the schema says whether
 * `true` is a boolean or a string and whether an element is a list or an object. A list's items are its child
 * elements, whatever their name (`<targets><target>`); an object's keys are its children's names. `options`, which
 * the schema leaves to the target, reads `true`, `false` and numbers as such and any other text as a string. Each
 * text is first evaluated as Maven evaluates `${...}` ([evaluate]). The tree is then checked by the app config
 * reader against the same schema, which names any key it does not know.
 */
internal class ConfigurationConverter(private val schema: JsonObject, private val evaluate: (String) -> String) {
    private val problems = mutableListOf<ConfigProblem>()

    /** Converts [elements], the top-level app-config keys the POM sets, each named by its key. */
    fun convert(elements: List<PlexusConfiguration>): ConversionOutcome {
        problems.clear()
        val tree = objectOf(elements, alternatives(schema), CONFIGURATION)

        return if (problems.isEmpty()) ConversionOutcome.Converted(tree) else ConversionOutcome.Refused(problems.toList())
    }

    private fun convert(element: PlexusConfiguration, schemas: List<JsonObject>, path: String): JsonElement {
        refuseAttributes(element, path)
        val types = typesOf(schemas)
        val children = element.children.toList()

        if (children.isEmpty()) return leaf(element.value, types, path)

        return when {
            ARRAY in types -> JsonArray(children.mapIndexed { index, child -> convert(child, itemSchemas(schemas), "$path/${child.name}[$index]") })
            OBJECT in types || types.isEmpty() -> objectOf(children, schemas, path)
            else -> refuse(path, "holds child elements, but the key takes ${typesText(types)}.", "Write the value as the element's text.")
        }
    }

    private fun objectOf(children: List<PlexusConfiguration>, schemas: List<JsonObject>, path: String): JsonObject {
        val members = linkedMapOf<String, JsonElement>()
        for (child in children) {
            val childPath = "$path/${child.name}"
            if (child.name in members) {
                refuse(childPath, "is set twice.", "Set it once; a list is written as one element whose children are its items.")
                continue
            }
            members[child.name] = convert(child, propertySchemas(schemas, child.name), childPath)
        }

        return JsonObject(members)
    }

    private fun leaf(rawText: String?, types: Set<String>, path: String): JsonElement {
        val text = rawText?.let(evaluate)?.trim()

        if (text.isNullOrEmpty()) {
            return when {
                ARRAY in types -> JsonArray(emptyList())
                OBJECT in types || types.isEmpty() -> JsonObject(emptyMap())
                else -> JsonPrimitive("")
            }
        }

        if (types.isEmpty()) return freeScalar(text)

        val asBoolean = JsonPrimitive(text).booleanOrNull
        if (BOOLEAN in types && asBoolean != null && text == asBoolean.toString()) return JsonPrimitive(asBoolean)
        if ((INTEGER in types || NUMBER in types) && NUMBER_TEXT.matches(text)) return JsonPrimitive(BigDecimal(text))
        if (STRING in types) return JsonPrimitive(text)

        return refuse(path, "is the text '$text', but the key takes ${typesText(types)}.", fixFor(types))
    }

    // A value the schema leaves free (a target's `options`): the JSON a YAML file would give for the same text.
    private fun freeScalar(text: String): JsonElement = when {
        text == "true" || text == "false" -> JsonPrimitive(text.toBoolean())
        NUMBER_TEXT.matches(text) -> JsonPrimitive(BigDecimal(text))
        else -> JsonPrimitive(text)
    }

    private fun refuseAttributes(element: PlexusConfiguration, path: String) {
        // Maven's own merge directives (`combine.children`, `combine.self`) are read by Maven, not by the plugin.
        val attributes = element.attributeNames.filterNot { it.startsWith(MAVEN_MERGE_PREFIX) }
        if (attributes.isNotEmpty()) {
            refuse(path, "has the attribute(s) ${attributes.joinToString { "'$it'" }}; the app config's keys are elements.", "Write each value as a child element.")
        }
    }

    private fun refuse(path: String, reason: String, fix: String): JsonElement {
        problems += ConfigProblem(SHAPE_CODE, "The <configuration> element $path $reason", fix, path)

        return JsonObject(emptyMap())
    }

    private fun fixFor(types: Set<String>): String = when {
        ARRAY in types -> "Write the list as one child element per item."
        OBJECT in types -> "Write the object as one child element per key."
        else -> "Write a value of the key's type."
    }

    // Every schema a value may match: `$ref`s resolved, `oneOf`, `anyOf` and `allOf` branches flattened.
    private fun alternatives(node: JsonObject): List<JsonObject> {
        val reference = node["\$ref"]?.jsonPrimitive?.content
        if (reference != null) return alternatives(resolve(reference))

        val branches = BRANCH_KEYWORDS.flatMap { keyword -> (node[keyword] as? JsonArray).orEmpty().map { it.jsonObject } }

        return listOf(node) + branches.flatMap(::alternatives)
    }

    private fun resolve(reference: String): JsonObject =
        reference.removePrefix("#/").split("/").fold(schema) { node, segment -> node.getValue(segment).jsonObject }

    private fun typesOf(schemas: List<JsonObject>): Set<String> = schemas.flatMapTo(linkedSetOf()) { node ->
        val declared = when (val type = node["type"]) {
            is JsonPrimitive -> listOf(type.content)
            is JsonArray -> type.map { it.jsonPrimitive.content }
            else -> emptyList()
        }
        val listed = ((node["enum"] as? JsonArray).orEmpty() + listOfNotNull(node["const"])).map(::jsonType)

        declared + listed
    }

    private fun jsonType(value: JsonElement): String = when {
        value is JsonArray -> ARRAY
        value is JsonObject -> OBJECT
        value is JsonPrimitive && value.isString -> STRING
        value is JsonPrimitive && value.booleanOrNull != null -> BOOLEAN
        else -> NUMBER
    }

    private fun propertySchemas(schemas: List<JsonObject>, key: String): List<JsonObject> {
        val named = schemas.mapNotNull { (it["properties"] as? JsonObject)?.get(key) as? JsonObject }
        if (named.isNotEmpty()) return named.flatMap(::alternatives)

        return schemas.mapNotNull { it["additionalProperties"] as? JsonObject }.flatMap(::alternatives)
    }

    private fun itemSchemas(schemas: List<JsonObject>): List<JsonObject> =
        schemas.mapNotNull { it["items"] as? JsonObject }.flatMap(::alternatives)

    private fun typesText(types: Set<String>): String = types.joinToString(" or ") { if (it == ARRAY) "a list" else "a $it" }

    internal companion object {
        const val SHAPE_CODE = "config.maven.shape"
        private const val CONFIGURATION = "<configuration>"
        private const val MAVEN_MERGE_PREFIX = "combine."
        private const val ARRAY = "array"
        private const val OBJECT = "object"
        private const val STRING = "string"
        private const val BOOLEAN = "boolean"
        private const val INTEGER = "integer"
        private const val NUMBER = "number"
        private val BRANCH_KEYWORDS = listOf("oneOf", "anyOf", "allOf")
        private val NUMBER_TEXT = Regex("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?")

        private const val APP_SCHEMA_RESOURCE = "/io/github/jubasse/seampact/ir/config/app.schema.json"

        /** `app.schema.json` as seampact-ir's jar holds it: the schema the app config reader checks the tree against. */
        val appSchema: JsonObject by lazy {
            val text = ConfigurationConverter::class.java.getResourceAsStream(APP_SCHEMA_RESOURCE)?.use { it.readBytes().decodeToString() }
                ?: error("seampact-ir holds no $APP_SCHEMA_RESOURCE; the plugin's classpath is incomplete.")
            Json.parseToJsonElement(text).jsonObject
        }
    }
}
