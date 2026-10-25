package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.ClassName
import com.palantir.javapoet.ParameterizedTypeName
import com.palantir.javapoet.TypeName
import com.palantir.javapoet.TypeSpec
import io.github.jubasse.seampact.ir.model.Operation
import io.github.jubasse.seampact.ir.model.Param
import io.github.jubasse.seampact.ir.model.Response
import io.github.jubasse.seampact.ir.model.ResponseShape
import javax.lang.model.element.Modifier

// Header parameters that carry a credential or its CSRF companion: printed redacted, like the credentials record, as
// is a parameter of a sensitive scalar.
private val CREDENTIAL_DERIVATION_PREFIXES = listOf("identity.", "csrf.")

internal const val STATUS_ARM_PREFIX = "Status"

/** The Java types of one operation: its input records, its result and its typed error result. */
internal class OperationTypes(
    private val layout: JavaLayout,
    private val mapper: TypeMapper,
    private val refusals: Refusals,
) {
    /** The input record and the path, query and headers records it holds, when the operation declares them. */
    fun inputTypes(operation: Operation, at: IrPlace): List<TypeSpec> {
        val names = layout.operation(operation.id)
        val parts = mutableListOf<TypeSpec>()
        val components = mutableListOf<RecordComponent>()

        fun addParams(className: ClassName, member: String, location: String, params: List<Param>) {
            if (params.isEmpty()) return

            parts += generatedRecord(className, paramComponents(params, at.below("params", location)), layout).build()
            components += RecordComponent(member, mapper.schemaReference(className))
        }

        addParams(names.path, "path", "path", operation.params.path)
        addParams(names.query, "query", "query", operation.params.query)
        addParams(names.headers, "headers", "header", operation.params.header)

        operation.input?.let { input ->
            components += RecordComponent("body", mapper.memberType(input.schema, Presence.REQUIRED), redacted = input.schema.isSensitive())
        }

        if (isSpringPageList(layout.ir, operation)) {
            components += RecordComponent(PAGEABLE_COMPONENT, JavaTypes.PAGEABLE, injectedAs = PAGEABLE_COMPONENT)
        }

        return parts + generatedRecord(names.input, components, layout).build()
    }

    private fun paramComponents(params: List<Param>, at: IrPlace): List<RecordComponent> {
        val names = MemberNames(at, refusals)

        return params.mapIndexedNotNull { index, param ->
            val name = names.claim(param.name, null, at.below(index, "name")) ?: return@mapIndexedNotNull null
            val derivation = param.derivedFrom?.derivation.orEmpty()

            RecordComponent(
                name = name,
                type = mapper.memberType(param.type, Presence.of(optional = !param.required, nullable = param.type.isNullable())),
                wireName = param.name,
                redacted = CREDENTIAL_DERIVATION_PREFIXES.any { derivation.startsWith(it) } || param.type.isSensitive(),
                writtenAsString = param.type.isDecimal(),
            )
        }
    }

    /**
     * The result: a sealed interface whose arms are one record per declared success status (`Status200`) and the
     * typed error result, itself a sealed interface with one record per code the operation lists.
     */
    fun resultTypes(operation: Operation): List<TypeSpec> {
        val names = layout.operation(operation.id)
        val result = TypeSpec.interfaceBuilder(names.result).addModifiers(Modifier.PUBLIC, Modifier.SEALED)

        val types = mutableListOf<TypeSpec>()
        for (response in operation.responses) {
            if (response.derivedFrom?.derivation == ETAG_DERIVATION) continue
            if (response.shape == ResponseShape.PAGE) pageItemType(response)?.let { item -> pageRecord(layout, operation, item)?.let { types += it } }

            val arm = names.result.nestedClass(STATUS_ARM_PREFIX + response.status)
            val components = listOfNotNull(responseBody(operation, response)?.let { RecordComponent("body", it, redacted = response.body?.isSensitive() == true) })
            result.addType(generatedRecord(arm, components, layout).addModifiers(Modifier.STATIC).addSuperinterface(names.result).build())
            result.addPermittedSubclass(arm)
        }

        val errors = errorsType(operation)
        if (errors != null) result.addPermittedSubclass(names.errors)

        return types + listOfNotNull(result.build(), errors)
    }

    private fun pageItemType(response: Response): TypeName? {
        val body = response.body ?: return null
        val presence = if (body.isNullable()) Presence.NULLABLE else Presence.REQUIRED

        return mapper.memberType(body, presence).boxedArgument()
    }

    private fun responseBody(operation: Operation, response: Response): TypeName? {
        val body = response.body ?: return null
        val presence = if (body.isNullable()) Presence.NULLABLE else Presence.REQUIRED

        return when (response.shape) {
            ResponseShape.ITEM -> mapper.memberType(body, presence)
            ResponseShape.LIST -> ParameterizedTypeName.get(JavaTypes.LIST, mapper.memberType(body, presence).boxedArgument())
            ResponseShape.TABLE -> ParameterizedTypeName.get(JavaTypes.MAP, JavaTypes.STRING, mapper.memberType(body, presence).boxedArgument())
            ResponseShape.PAGE -> if (isSpringPageList(layout.ir, operation)) {
                pageItemType(response)?.let { ParameterizedTypeName.get(JavaTypes.PAGE, it) }
            } else {
                layout.operation(operation.id).page
            }
            else -> null
        }
    }

    private fun errorsType(operation: Operation): TypeSpec? {
        if (operation.errors.isEmpty()) return null

        val names = layout.operation(operation.id)
        val errors = TypeSpec.interfaceBuilder(names.errors)
            .addModifiers(Modifier.PUBLIC, Modifier.SEALED)
            .addSuperinterface(names.result)
        val armNames = HashSet<String>()

        for (error in operation.errors) {
            val armName = layout.errorArm(error.code) ?: continue
            if (!armNames.add(armName)) continue

            val params = layout.ir.errors[error.code]?.params?.let { layout.schemaClass(it) }
            val components = listOfNotNull(params?.let { RecordComponent("params", mapper.schemaReference(it)) })
            val arm = names.errors.nestedClass(armName)
            errors.addType(generatedRecord(arm, components, layout).addModifiers(Modifier.STATIC).addSuperinterface(names.errors).build())
            errors.addPermittedSubclass(arm)
        }

        return errors.build()
    }
}

private fun TypeName.boxedArgument(): TypeName = if (isPrimitive) box() else this
