package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.CodeBlock
import com.palantir.javapoet.MethodSpec
import com.palantir.javapoet.TypeSpec
import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.IrJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import javax.lang.model.element.Modifier

// IR members only tooling reads; the boundary never does.
private val TOOLING_MEMBERS = setOf("derivedFrom", "origin", "docs", "examples", "maturity")

// The declarations the boundary reads beside the kept operations and the schemas and enums they reach.
private val DECLARATION_MEMBERS = listOf("api", "errors", "formats", "identities", "schemes", "scopes", "rights", "rules")

// A Java string constant holds at most 65535 UTF-8 bytes: a chunk of 8000 characters always fits.
private const val CHUNK_CHARACTERS = 8000

private const val BOOT_CHECK = "bootCheck"
private const val HOOKS_OFF = "off"

/**
 * The api's contract table (ADR 0022 "Placement"): the IR view of the kept operations, the declarations they read
 * and the entry's settings, as JSON text the copied runtime reads with its own mapper. It is the IR itself, with the
 * members only tooling reads removed, so no third format exists between the IR and the boundary.
 */
internal fun contractTableType(layout: JavaLayout, options: SpringBootOptions, entry: SpringBootEntry): TypeSpec {
    val text = contractTable(layout, options, entry).toString()
    val chunks = text.chunked(CHUNK_CHARACTERS)
    val join = CodeBlock.builder().add("return String.join(\$S", "")
    chunks.forEach { join.add(",\n\$S", it) }
    join.add(");\n")

    return TypeSpec.classBuilder(layout.contractTable)
        .addJavadoc("The contract of the api '\$L' as its boundary reads it: the IR view of the kept operations and the entry's settings.\n", layout.ir.api.id)
        .addModifiers(Modifier.PUBLIC, Modifier.FINAL)
        .addMethod(MethodSpec.constructorBuilder().addModifiers(Modifier.PRIVATE).build())
        .addMethod(
            MethodSpec.methodBuilder("json")
                .addModifiers(Modifier.PUBLIC, Modifier.STATIC)
                .returns(JavaTypes.STRING)
                .addCode(join.build())
                .build(),
        )
        .build()
}

private fun contractTable(layout: JavaLayout, options: SpringBootOptions, entry: SpringBootEntry): JsonObject {
    val ir = IrJson.encodeToJsonElement(ContractIR.serializer(), layout.ir).jsonObject
    val keptOperations = layout.kept.operations.map { (_, operation) -> operation.id }.toSet()
    val keptSchemas = layout.kept.objects.keys
    val keptEnums = layout.kept.enums

    val view = buildJsonObject {
        for (member in DECLARATION_MEMBERS) ir[member]?.let { put(member, it) }
        put("operations", JsonArray((ir["operations"] as JsonArray).filter { (it.jsonObject["id"] as JsonPrimitive).content in keptOperations }))
        put("schemas", JsonObject((ir["schemas"] as JsonObject).filterKeys { it in keptSchemas }))
        put("enums", JsonObject((ir["enums"] as JsonObject).filterKeys { it in keptEnums }))
        put("settings", settings(options, entry))
    }

    return withoutToolingMembers(view) as JsonObject
}

private fun settings(options: SpringBootOptions, entry: SpringBootEntry): JsonObject {
    val bootCheck = entry.artefacts[BOOT_CHECK]
    val everyCheck = bootCheck != JsonPrimitive(false)
    val checks = bootCheck as? JsonObject

    return buildJsonObject {
        put("responses", options.responses.wire)
        put("bodyValidation", options.bodyValidation)
        put("frameworkEtag", options.frameworkEtag.wire)
        put("catchAll", options.catchAll)
        put("frameworkRoutes", JsonArray(entry.frameworkRoutes.map { it.toJson() }))
        put(
            BOOT_CHECK,
            buildJsonObject {
                put("hooks", everyCheck && (checks?.get("hooks") as? JsonPrimitive)?.content != HOOKS_OFF)
                put("handlers", everyCheck)
                put("frameworkRoutes", everyCheck && checks?.get("frameworkRoutes") != JsonPrimitive(false))
            },
        )
    }
}

private fun withoutToolingMembers(element: JsonElement): JsonElement = when (element) {
    is JsonObject -> JsonObject(element.filterKeys { it !in TOOLING_MEMBERS }.mapValues { withoutToolingMembers(it.value) })
    is JsonArray -> JsonArray(element.map(::withoutToolingMembers))
    else -> element
}
