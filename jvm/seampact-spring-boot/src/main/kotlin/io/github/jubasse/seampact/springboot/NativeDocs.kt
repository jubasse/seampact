package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.AnnotationSpec
import com.palantir.javapoet.ClassName
import com.palantir.javapoet.ParameterizedTypeName
import com.palantir.javapoet.TypeName
import io.github.jubasse.seampact.ir.model.Operation
import io.github.jubasse.seampact.ir.model.Response
import kotlinx.serialization.json.JsonPrimitive

private const val SWAGGER_ANNOTATIONS = "io.swagger.v3.oas.annotations"
private val SWAGGER_OPERATION = ClassName.get(SWAGGER_ANNOTATIONS, "Operation")
private val SWAGGER_PARAMETER = ClassName.get(SWAGGER_ANNOTATIONS, "Parameter")
private val SWAGGER_API_RESPONSE = ClassName.get("$SWAGGER_ANNOTATIONS.responses", "ApiResponse")
private val SWAGGER_CONTENT = ClassName.get("$SWAGGER_ANNOTATIONS.media", "Content")
private val SWAGGER_SCHEMA = ClassName.get("$SWAGGER_ANNOTATIONS.media", "Schema")
private val SWAGGER_ARRAY_SCHEMA = ClassName.get("$SWAGGER_ANNOTATIONS.media", "ArraySchema")

/** The OpenAPI type of a table body, whose values the additional properties schema names. */
private const val OBJECT_SCHEMA_TYPE = "object"

/** The entry's `artefacts` member that turns the springdoc annotations on. */
internal const val NATIVE_DOCS_ARTEFACT = "nativeDocs"

/** Whether the endpoints interfaces carry springdoc's annotations (ADR 0022, `artefacts.nativeDocs`). */
internal enum class NativeDocs {
    OFF,
    SPRINGDOC,
    ;

    companion object {
        fun of(entry: SpringBootEntry): NativeDocs = if (entry.artefacts[NATIVE_DOCS_ARTEFACT] == JsonPrimitive(true)) SPRINGDOC else OFF
    }
}

/**
 * springdoc's `@Operation` of a contract operation: its id, its docs, whether it is deprecated, and one `@ApiResponse`
 * per declared success with the body schema the contract declares for it, never the handler's result wrapper, so the
 * framework's own document names the contract's operations. [bodyType] is the Java type of a response's body; a body
 * springdoc's annotations cannot name is refused.
 */
internal fun springdocOperation(operation: Operation, at: IrPlace, bodyType: (Response) -> TypeName?, refusals: Refusals): AnnotationSpec {
    val annotation = AnnotationSpec.builder(SWAGGER_OPERATION).addMember("operationId", "\$S", operation.id)

    operation.docs.summary?.let { annotation.addMember("summary", "\$S", it) }
    operation.docs.description?.let { annotation.addMember("description", "\$S", it) }
    if (operation.deprecated != null) annotation.addMember("deprecated", "true")

    for (status in operation.responses.map { it.status }.distinct()) {
        val responseIndex = operation.responses.indexOfFirst { it.status == status }
        val response = operation.responses[responseIndex]
        val description = response.docs?.summary ?: response.docs?.description ?: ""
        val body = bodyType(response)
        val content = springdocContent(response, body)
        if (content == null) {
            refusals.waiting("nativeDocs.body", "springdoc's schema of the response body '$body'", at.below("responses", responseIndex, "body"), Delivery.CONSUMER)
            continue
        }

        annotation.addMember(
            "responses",
            "\$L",
            AnnotationSpec.builder(SWAGGER_API_RESPONSE)
                .addMember("responseCode", "\$S", status.toString())
                .addMember("description", "\$S", description)
                .addMember("content", "\$L", content)
                .build(),
        )
    }

    return annotation.build()
}

// An empty `@Content` documents a response without a body; null when the annotations cannot name the body's type.
private fun springdocContent(response: Response, body: TypeName?): AnnotationSpec? {
    val content = AnnotationSpec.builder(SWAGGER_CONTENT)
    if (body == null) return content.build()

    response.media?.let { content.addMember("mediaType", "\$S", it) }
    val bare = body.withoutAnnotations()
    if (bare is ClassName) return content.addMember("schema", "\$L", implementationSchema(bare)).build()
    if (bare !is ParameterizedTypeName) return null

    val values = bare.typeArguments().last().withoutAnnotations() as? ClassName ?: return null
    return when (bare.rawType()) {
        JavaTypes.LIST -> content.addMember("array", "\$L", AnnotationSpec.builder(SWAGGER_ARRAY_SCHEMA).addMember("schema", "\$L", implementationSchema(values)).build()).build()
        JavaTypes.MAP -> content.addMember(
            "schema",
            "\$L",
            AnnotationSpec.builder(SWAGGER_SCHEMA).addMember("type", "\$S", OBJECT_SCHEMA_TYPE).addMember("additionalPropertiesSchema", "\$T.class", values).build(),
        ).build()
        else -> null
    }
}

private fun implementationSchema(type: ClassName): AnnotationSpec =
    AnnotationSpec.builder(SWAGGER_SCHEMA).addMember("implementation", "\$T.class", type).build()

/** Hides the handler's `input` record from springdoc: the boundary binds it, never Spring's argument resolvers. */
internal fun springdocHiddenInput(): AnnotationSpec =
    AnnotationSpec.builder(SWAGGER_PARAMETER).addMember("hidden", "true").build()
