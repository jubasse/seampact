package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.AnnotationSpec
import com.palantir.javapoet.ClassName
import io.github.jubasse.seampact.ir.model.Operation
import kotlinx.serialization.json.JsonPrimitive

private const val SWAGGER_ANNOTATIONS = "io.swagger.v3.oas.annotations"
private val SWAGGER_OPERATION = ClassName.get(SWAGGER_ANNOTATIONS, "Operation")
private val SWAGGER_PARAMETER = ClassName.get(SWAGGER_ANNOTATIONS, "Parameter")
private val SWAGGER_API_RESPONSE = ClassName.get("$SWAGGER_ANNOTATIONS.responses", "ApiResponse")

/** The entry's `artefacts` member that turns the springdoc annotations on. */
private const val NATIVE_DOCS_ARTEFACT = "nativeDocs"

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
 * per declared success, so the framework's own document names the contract's operations.
 */
internal fun springdocOperation(operation: Operation): AnnotationSpec {
    val annotation = AnnotationSpec.builder(SWAGGER_OPERATION).addMember("operationId", "\$S", operation.id)

    operation.docs.summary?.let { annotation.addMember("summary", "\$S", it) }
    operation.docs.description?.let { annotation.addMember("description", "\$S", it) }
    if (operation.deprecated != null) annotation.addMember("deprecated", "true")

    for (status in operation.responses.map { it.status }.distinct()) {
        val response = operation.responses.first { it.status == status }
        val description = response.docs?.summary ?: response.docs?.description ?: ""
        annotation.addMember(
            "responses",
            "\$L",
            AnnotationSpec.builder(SWAGGER_API_RESPONSE)
                .addMember("responseCode", "\$S", status.toString())
                .addMember("description", "\$S", description)
                .build(),
        )
    }

    return annotation.build()
}

/** Hides the handler's `input` record from springdoc: the boundary binds it, never Spring's argument resolvers. */
internal fun springdocHiddenInput(): AnnotationSpec =
    AnnotationSpec.builder(SWAGGER_PARAMETER).addMember("hidden", "true").build()
