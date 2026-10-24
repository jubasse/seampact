package io.github.jubasse.seampact.ir.schema

import com.networknt.schema.Error
import com.networknt.schema.Schema
import com.networknt.schema.SchemaLocation
import com.networknt.schema.SchemaRegistry
import com.networknt.schema.SpecificationVersion
import java.util.Locale
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import tools.jackson.databind.JsonNode
import tools.jackson.databind.node.JsonNodeFactory

/**
 * One failure of a JSON Schema 2020-12 validation: where in the instance ([instancePath], each segment a member
 * name or an array index), the [keyword] that failed, the validator's [message] without its location prefix, the
 * member it names for `required` and `additionalProperties` ([property]), and the schema [evaluationPath] it
 * failed under, as a JSON pointer.
 */
internal data class SchemaViolation(
    val instancePath: List<Any>,
    val keyword: String,
    val message: String,
    val property: String?,
    val evaluationPath: String,
)

/**
 * A set of `@seampact/spec` JSON Schemas copied into the jar, validated with a pinned JSON Schema 2020-12
 * validator, so no schema is ported by hand. Every `$ref` resolves inside the set: the validator never fetches a
 * remote resource. Building the set compiles the schemas, so each set is built once per process.
 */
internal class SpecSchemas(resourceDirectory: String, private val idDirectory: String, fileNames: List<String>) {
    private val registry: SchemaRegistry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12) { builder ->
        val contents = fileNames.associate { "$idDirectory/$it" to resourceText("$resourceDirectory/$it") }
        builder.schemaLoader { loader ->
            loader.fetchRemoteResources(false)
            loader.resourceLoaders { resources -> resources.resources(contents) }
        }
    }

    private val compiled = HashMap<String, Schema>()

    /** Every violation of [instance] against the schema of [fileName]. */
    @Synchronized
    fun validate(fileName: String, instance: JsonElement): List<SchemaViolation> {
        val schema = compiled.getOrPut(fileName) {
            registry.getSchema(SchemaLocation.of("$idDirectory/$fileName")).also { it.initializeValidators() }
        }

        // The messages are the validator's English ones whatever the build machine's locale, as Ajv's are.
        val errors = schema.validate(jacksonNodeOf(instance)) { context ->
            context.executionConfig { config -> config.locale(Locale.ENGLISH) }
        }

        return errors.map(::violationOf)
    }
}

private fun resourceText(path: String): String {
    val stream = SpecSchemas::class.java.classLoader.getResourceAsStream(path)
        ?: error("seampact-ir: the schema resource '$path' is missing from the jar; rebuild seampact-ir.")

    return stream.use { it.readBytes().toString(Charsets.UTF_8) }
}

private fun violationOf(error: Error): SchemaViolation {
    val location = error.instanceLocation
    val path = (0 until location.nameCount).map { index -> location.getElement(index) ?: location.getName(index) }

    return SchemaViolation(
        instancePath = path.map { if (it is Int) it else it.toString() },
        keyword = error.keyword ?: "",
        message = withoutLocationPrefix(error.message ?: error.keyword ?: "fails the schema", location.toString()),
        property = error.property,
        evaluationPath = pointerOf(error.evaluationPath),
    )
}

// The validator starts each message with the instance location (`$.targets[0]: ...`); a problem names it its way.
private fun withoutLocationPrefix(message: String, location: String): String =
    message.removePrefix("$location: ").removePrefix("$location ")

private fun pointerOf(path: com.networknt.schema.path.NodePath): String =
    (0 until path.nameCount).joinToString("") { index -> "/${path.getElement(index) ?: path.getName(index)}" }

private val NODES = JsonNodeFactory.instance

/** The validator reads Jackson trees; each value is copied, numbers keeping their written digits. */
internal fun jacksonNodeOf(element: JsonElement): JsonNode = when (element) {
    is JsonNull -> NODES.nullNode()
    is JsonObject -> NODES.objectNode().also { node -> element.forEach { (key, value) -> node.set(key, jacksonNodeOf(value)) } }
    is JsonArray -> NODES.arrayNode().also { node -> element.forEach { node.add(jacksonNodeOf(it)) } }
    is JsonPrimitive -> primitiveNodeOf(element)
}

private fun primitiveNodeOf(element: JsonPrimitive): JsonNode {
    if (element.isString) return NODES.stringNode(element.content)

    val boolean = element.booleanOrNull
    if (boolean != null) return NODES.booleanNode(boolean)

    val content = element.content
    val integer = content.toBigIntegerOrNull()
    if (integer != null) return NODES.numberNode(integer)

    return content.toBigDecimalOrNull()?.let(NODES::numberNode) ?: NODES.numberNode(content.toDouble())
}
