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
private val DECLARATION_MEMBERS = listOf("api", "errors", "formats", "pagings", "identities", "schemes", "scopes", "rights", "rules")

// A Java string constant holds at most 65535 UTF-8 bytes: a chunk of 8000 characters always fits.
private const val CHUNK_CHARACTERS = 8000

private const val BOOT_CHECK = "bootCheck"
private const val EXEMPT_IDEMPOTENCY = "exempt"

// The one derived header param that is part of the request: it selects the body variant of a header-tagged union.
private const val UNION_TAG_DERIVATION = "union.headerTag"
private const val FRAMEWORK_DOCS_KEEP = "keep"
private const val HOOKS_OFF = "off"

/**
 * The api's contract table (ADR 0022 "Placement"): the IR view of the kept operations, the declarations they read
 * and the entry's settings, as JSON text the runtime reads with its own mapper. It is the IR itself, with the
 * members only tooling reads removed, so no third format exists between the IR and the boundary. The one fact read
 * from a removed member, which header params count for an idempotency fingerprint, is in the settings (`fingerprintHeaders`).
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

    val operations = (ir["operations"] as JsonArray).filter { (it.jsonObject["id"] as JsonPrimitive).content in keptOperations }

    val view = buildJsonObject {
        for (member in DECLARATION_MEMBERS) ir[member]?.let { put(member, it) }
        put("operations", JsonArray(operations))
        put("schemas", JsonObject((ir["schemas"] as JsonObject).filterKeys { it in keptSchemas }))
        put("enums", JsonObject((ir["enums"] as JsonObject).filterKeys { it in keptEnums }))
        put("settings", settings(options, entry, operations))
    }

    return withoutToolingMembers(view) as JsonObject
}

// Which app routes the framework-route check reads: those under the contract's base paths, or every one.
private const val STRICT_SCOPE = "strict"
private const val CONTRACT_SCOPE = "contract"

private fun settings(options: SpringBootOptions, entry: SpringBootEntry, operations: List<JsonElement>): JsonObject {
    val bootCheck = entry.artefacts[BOOT_CHECK]
    val everyCheck = bootCheck != JsonPrimitive(false)
    val checks = bootCheck as? JsonObject

    return buildJsonObject {
        put("responses", options.responses.wire)
        put("bodyValidation", options.bodyValidation)
        put("frameworkEtag", options.frameworkEtag.wire)
        put("catchAll", options.catchAll)
        put("frameworkDocs", entry.frameworkDocs ?: FRAMEWORK_DOCS_KEEP)
        put("frameworkRoutes", JsonArray(entry.frameworkRoutes.map { it.toJson() }))
        put("mount", entry.mount)
        put(
            BOOT_CHECK,
            buildJsonObject {
                put("hooks", everyCheck && (checks?.get("hooks") as? JsonPrimitive)?.content != HOOKS_OFF)
                put("handlers", everyCheck)
                put("frameworkRoutes", everyCheck && checks?.get("frameworkRoutes") != JsonPrimitive(false))
                put("frameworkRouteScope", if (checks?.get("frameworkRoutes") == JsonPrimitive(STRICT_SCOPE)) STRICT_SCOPE else CONTRACT_SCOPE)
            },
        )
        put("fingerprintHeaders", fingerprintHeaders(operations))
    }
}

// Per idempotent operation, the header params the author declared and a union tag, lower case: the only headers its
// fingerprint digests. Any other header param the compiler derives (trace, deadline, the key, CSRF) changes on a
// retry (ADR 0012).
internal fun fingerprintHeaders(operations: List<JsonElement>): JsonObject = buildJsonObject {
    for (operation in operations.map { it.jsonObject }) {
        val idempotency = operation["idempotency"] as? JsonObject ?: continue
        if ((idempotency["kind"] as? JsonPrimitive)?.content == EXEMPT_IDEMPOTENCY) continue

        val headerParams = ((operation["params"] as JsonObject)["header"] as JsonArray).map { it.jsonObject }
        val counted = headerParams.filter(::isFingerprinted).map { (it["name"] as JsonPrimitive).content.lowercase() }
        put((operation["id"] as JsonPrimitive).content, JsonArray(counted.map(::JsonPrimitive)))
    }
}

private fun withoutToolingMembers(element: JsonElement): JsonElement = when (element) {
    is JsonObject -> JsonObject(element.filterKeys { it !in TOOLING_MEMBERS }.mapValues { withoutToolingMembers(it.value) })
    is JsonArray -> JsonArray(element.map(::withoutToolingMembers))
    else -> element
}

private fun isFingerprinted(headerParam: JsonObject): Boolean {
    val derivedFrom = headerParam["derivedFrom"] as? JsonObject ?: return true

    return (derivedFrom["derivation"] as? JsonPrimitive)?.content == UNION_TAG_DERIVATION
}
