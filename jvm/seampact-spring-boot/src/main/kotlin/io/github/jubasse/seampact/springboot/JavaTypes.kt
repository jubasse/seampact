package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.AnnotationSpec
import com.palantir.javapoet.ClassName
import com.palantir.javapoet.CodeBlock
import com.palantir.javapoet.MethodSpec
import com.palantir.javapoet.ParameterSpec
import com.palantir.javapoet.ParameterizedTypeName
import com.palantir.javapoet.TypeName
import io.github.jubasse.seampact.ir.model.ArrayTypeUse
import io.github.jubasse.seampact.ir.model.EnumTypeUse
import io.github.jubasse.seampact.ir.model.RefTypeUse
import io.github.jubasse.seampact.ir.model.Refinements
import io.github.jubasse.seampact.ir.model.ScalarType
import io.github.jubasse.seampact.ir.model.OpaqueTypeUse
import io.github.jubasse.seampact.ir.model.ScalarTypeUse
import io.github.jubasse.seampact.ir.model.TypeUse
import javax.lang.model.element.Modifier

internal object JavaTypes {
    val STRING: ClassName = ClassName.get("java.lang", "String")
    val OBJECT: ClassName = ClassName.get("java.lang", "Object")
    val OVERRIDE: ClassName = ClassName.get("java.lang", "Override")
    val OPTIONAL: ClassName = ClassName.get("java.util", "Optional")
    val LIST: ClassName = ClassName.get("java.util", "List")
    val MAP: ClassName = ClassName.get("java.util", "Map")
    val JSON_NODE: ClassName = ClassName.get("tools.jackson.databind", "JsonNode")
    val UUID: ClassName = ClassName.get("java.util", "UUID")
    val BIG_DECIMAL: ClassName = ClassName.get("java.math", "BigDecimal")
    val OFFSET_DATE_TIME: ClassName = ClassName.get("java.time", "OffsetDateTime")
    val LOCAL_DATE: ClassName = ClassName.get("java.time", "LocalDate")
    val FIELD: ClassName = ClassName.get("io.github.jubasse.seampact.hooks", "Field")
    val JSON_IGNORE: ClassName = ClassName.get("com.fasterxml.jackson.annotation", "JsonIgnore")
    val JSON_PROPERTY: ClassName = ClassName.get("com.fasterxml.jackson.annotation", "JsonProperty")
    val JSON_FORMAT: ClassName = ClassName.get("com.fasterxml.jackson.annotation", "JsonFormat")
    val JSON_INCLUDE: ClassName = ClassName.get("com.fasterxml.jackson.annotation", "JsonInclude")
    val JACKSON_INJECT: ClassName = ClassName.get("com.fasterxml.jackson.annotation", "JacksonInject")
    val OPT_BOOLEAN: ClassName = ClassName.get("com.fasterxml.jackson.annotation", "OptBoolean")
    val PAGEABLE: ClassName = ClassName.get("org.springframework.data.domain", "Pageable")
    val PAGE: ClassName = ClassName.get("org.springframework.data.domain", "Page")

    val NOT_NULL: ClassName = ClassName.get("jakarta.validation.constraints", "NotNull")
    val VALID: ClassName = ClassName.get("jakarta.validation", "Valid")
}

/** How a member holds its value (ADR 0022 "Types and validation"). */
internal enum class Presence {
    /** Present and never null. */
    REQUIRED,

    /** Present, possibly null: a plain reference. */
    NULLABLE,

    /** Possibly absent, never null: `Optional<T>`. */
    OPTIONAL,

    /** Absent, null or a value: `Field<T>`. */
    THREE_STATE,
    ;

    companion object {
        fun of(optional: Boolean, nullable: Boolean): Presence = when {
            optional && nullable -> THREE_STATE
            optional -> OPTIONAL
            nullable -> NULLABLE
            else -> REQUIRED
        }
    }
}

/**
 * Java types of IR type uses, carrying the Bean Validation constraints whose Jakarta meaning is the contract's:
 * `@Min`, `@Max`, `@DecimalMin` and `@DecimalMax`, `@Size` on arrays, `@NotNull`, and `@Valid` on records. String
 * lengths, patterns, formats and `multipleOf` differ in meaning and are left to the generated structural validator.
 */
internal class TypeMapper(private val layout: JavaLayout) {
    /** The type of a member with [presence]; a type the layout did not name is reported by [KeptForms] already. */
    fun memberType(type: TypeUse, presence: Presence): TypeName = when (presence) {
        Presence.REQUIRED -> required(type)
        Presence.NULLABLE -> valueType(type, boxed = true)
        Presence.OPTIONAL -> ParameterizedTypeName.get(JavaTypes.OPTIONAL, valueType(type, boxed = true))
        Presence.THREE_STATE -> ParameterizedTypeName.get(JavaTypes.FIELD, valueType(type, boxed = true))
    }

    /** A required, validated reference to a generated record. */
    fun schemaReference(className: ClassName): TypeName =
        className.annotated(AnnotationSpec.builder(JavaTypes.VALID).build(), AnnotationSpec.builder(JavaTypes.NOT_NULL).build())

    private fun required(type: TypeUse): TypeName {
        val value = valueType(type, boxed = false)
        if (value.isPrimitive) return value

        return value.annotated(AnnotationSpec.builder(JavaTypes.NOT_NULL).build())
    }

    private fun valueType(type: TypeUse, boxed: Boolean): TypeName = when (type) {
        is RefTypeUse -> (layout.schemaClass(type.schema) ?: JavaTypes.OBJECT).annotated(AnnotationSpec.builder(JavaTypes.VALID).build())
        is EnumTypeUse -> layout.enumClass(type.enum) ?: JavaTypes.OBJECT
        is ArrayTypeUse -> arrayType(type)
        is ScalarTypeUse -> scalarType(type, boxed)
        // An opaque value is any JSON the contract does not shape: the handler reads it as a tree.
        is OpaqueTypeUse -> JavaTypes.JSON_NODE
        else -> JavaTypes.OBJECT
    }

    private fun arrayType(type: ArrayTypeUse): TypeName {
        val itemPresence = if (type.items.isNullable()) Presence.NULLABLE else Presence.REQUIRED
        val itemType = memberType(type.items, itemPresence).let { if (it.isPrimitive) it.box() else it }
        val list = ParameterizedTypeName.get(JavaTypes.LIST, itemType)
        if (type.minItems == null && type.maxItems == null) return list

        val size = AnnotationSpec.builder(SIZE_CLASS)
        type.minItems?.let { size.addMember("min", "\$L", it) }
        type.maxItems?.let { size.addMember("max", "\$L", it) }

        return list.annotated(size.build())
    }

    private fun scalarType(type: ScalarTypeUse, boxed: Boolean): TypeName {
        val base: TypeName = when (type.type) {
            ScalarType.STRING -> STRING_FORMAT_TYPES[type.format] ?: JavaTypes.STRING
            ScalarType.BOOLEAN -> if (boxed) TypeName.BOOLEAN.box() else TypeName.BOOLEAN
            ScalarType.INTEGER -> if (boxed) TypeName.LONG.box() else TypeName.LONG
            ScalarType.NUMBER -> if (boxed) TypeName.DOUBLE.box() else TypeName.DOUBLE
            else -> JavaTypes.OBJECT
        }
        val bounds = boundAnnotations(type.refinements, integer = type.type == ScalarType.INTEGER)

        return if (bounds.isEmpty()) base else base.annotated(bounds)
    }

    private fun boundAnnotations(refinements: Refinements, integer: Boolean): List<AnnotationSpec> = listOfNotNull(
        refinements.minimum?.let { bound(it, inclusive = true, lower = true, integer) },
        refinements.exclusiveMinimum?.let { bound(it, inclusive = false, lower = true, integer) },
        refinements.maximum?.let { bound(it, inclusive = true, lower = false, integer) },
        refinements.exclusiveMaximum?.let { bound(it, inclusive = false, lower = false, integer) },
    )

    // `@Min` and `@Max` take a long, so an inclusive whole bound of an integer uses them; any other bound is a
    // `@DecimalMin` or `@DecimalMax` with its `inclusive` flag.
    private fun bound(literal: String, inclusive: Boolean, lower: Boolean, integer: Boolean): AnnotationSpec {
        val whole = literal.toLongOrNull()
        if (integer && inclusive && whole != null) {
            return AnnotationSpec.builder(if (lower) MIN_CLASS else MAX_CLASS).addMember("value", "\$L", wholeLiteral(whole)).build()
        }

        val annotation = AnnotationSpec.builder(if (lower) DECIMAL_MIN_CLASS else DECIMAL_MAX_CLASS).addMember("value", "\$S", literal)
        if (!inclusive) annotation.addMember("inclusive", "false")

        return annotation.build()
    }

    private fun wholeLiteral(value: Long): String = if (value in Int.MIN_VALUE..Int.MAX_VALUE) value.toString() else "${value}L"

    private companion object {
        val SIZE_CLASS: ClassName = ClassName.get("jakarta.validation.constraints", "Size")
        val MIN_CLASS: ClassName = ClassName.get("jakarta.validation.constraints", "Min")
        val MAX_CLASS: ClassName = ClassName.get("jakarta.validation.constraints", "Max")
        val DECIMAL_MIN_CLASS: ClassName = ClassName.get("jakarta.validation.constraints", "DecimalMin")
        val DECIMAL_MAX_CLASS: ClassName = ClassName.get("jakarta.validation.constraints", "DecimalMax")
        // Portable string formats with a java.time, java.util or java.math type; any other format stays a String,
        // checked by the generated structural validator. A decimal keeps its string wire shape (see isDecimal).
        val STRING_FORMAT_TYPES: Map<String?, ClassName> = mapOf(
            "uuid" to JavaTypes.UUID,
            "date-time" to JavaTypes.OFFSET_DATE_TIME,
            "date" to JavaTypes.LOCAL_DATE,
            DECIMAL_FORMAT to JavaTypes.BIG_DECIMAL,
        )
    }
}

private const val DECIMAL_FORMAT = "decimal"

/** Whether a type use, or the items of an array of it, is a decimal: a `BigDecimal` written as a JSON string. */
internal fun TypeUse.isDecimal(): Boolean = when (this) {
    is ScalarTypeUse -> type == ScalarType.STRING && format == DECIMAL_FORMAT
    is ArrayTypeUse -> items.isDecimal()
    else -> false
}

/** Whether a type use, or the items of an array of it, is a use of a scalar declared sensitive (ADR 0022 "Redaction"). */
internal fun TypeUse.isSensitive(): Boolean = when (this) {
    is ScalarTypeUse -> sensitive == true
    is ArrayTypeUse -> items.isSensitive()
    else -> false
}

/** Whether a type use, written as a parameter or an item, may be JSON null. */
internal fun TypeUse.isNullable(): Boolean = when (this) {
    is RefTypeUse -> nullable == true
    is ArrayTypeUse -> nullable == true
    is EnumTypeUse -> nullable == true
    is ScalarTypeUse -> nullable == true
    else -> false
}

/**
 * One component of a generated record. [redacted] members print as the redaction constant in `toString()`;
 * [writtenAsString] members (decimals) keep a JSON string on the wire.
 */
internal data class RecordComponent(
    val name: String,
    val type: TypeName,
    val wireName: String? = null,
    val redacted: Boolean = false,
    val writtenAsString: Boolean = false,
    /** The id of a value the boundary injects when it binds the record, never read from the request. */
    val injectedAs: String? = null,
    /** Left out of the record's Jackson serialization and of its `toString()`: not a wire value, may hold sensitive data. */
    val withheld: Boolean = false,
)

/**
 * The canonical constructor's parameters, each with `@JsonProperty` when its wire name differs from the Java name,
 * `@JacksonInject` when the boundary injects it, and `@JsonFormat(shape = STRING)` when it is written as a string.
 */
internal fun recordConstructor(components: List<RecordComponent>): MethodSpec {
    val constructor = MethodSpec.constructorBuilder()

    for (component in components) {
        val parameter = ParameterSpec.builder(component.type, component.name)
        if (component.wireName != null && component.wireName != component.name) {
            parameter.addAnnotation(AnnotationSpec.builder(JavaTypes.JSON_PROPERTY).addMember("value", "\$S", component.wireName).build())
        }
        if (component.injectedAs != null) {
            parameter.addAnnotation(
                AnnotationSpec.builder(JavaTypes.JACKSON_INJECT)
                    .addMember("value", "\$S", component.injectedAs)
                    .addMember("useInput", "\$T.FALSE", JavaTypes.OPT_BOOLEAN)
                    .build(),
            )
        }
        if (component.withheld) parameter.addAnnotation(JavaTypes.JSON_IGNORE)
        if (component.writtenAsString) {
            parameter.addAnnotation(AnnotationSpec.builder(JavaTypes.JSON_FORMAT).addMember("shape", "\$T.Shape.STRING", JavaTypes.JSON_FORMAT).build())
        }
        constructor.addParameter(parameter.build())
    }

    return constructor.build()
}

/**
 * The generated `toString()` of a record or exception (ADR 0022 "Redaction"): the record's own form,
 * `Name[a=1, b=2]` read through the accessors (qualified by `this`, so a contextual keyword such as `yield` stays a
 * call), with every [RecordComponent.redacted] value printed as the api's
 * redaction constant.
 */
internal fun redactedToString(typeName: String, components: List<RecordComponent>, redaction: ClassName): MethodSpec {
    val body = CodeBlock.builder()
    var pendingText = "$typeName["

    components.filterNot { it.withheld }.forEachIndexed { index, component ->
        pendingText += (if (index > 0) ", " else "") + component.name + "="
        if (component.redacted) {
            body.add("\$S + \$T.REDACTED + ", pendingText, redaction)
        } else {
            body.add("\$S + this.\$N() + ", pendingText, component.name)
        }
        pendingText = ""
    }

    return MethodSpec.methodBuilder("toString")
        .addAnnotation(JavaTypes.OVERRIDE)
        .addModifiers(Modifier.PUBLIC)
        .returns(JavaTypes.STRING)
        .addStatement("return \$L\$S", body.build(), "$pendingText]")
        .build()
}
