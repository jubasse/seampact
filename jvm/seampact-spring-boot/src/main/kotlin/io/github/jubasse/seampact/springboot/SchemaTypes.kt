package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.AnnotationSpec
import com.palantir.javapoet.ClassName
import com.palantir.javapoet.FieldSpec
import com.palantir.javapoet.MethodSpec
import com.palantir.javapoet.TypeSpec
import io.github.jubasse.seampact.ir.model.Enum_
import io.github.jubasse.seampact.ir.model.Name
import io.github.jubasse.seampact.ir.model.ObjectSchema
import io.github.jubasse.seampact.ir.naming.NameSource
import io.github.jubasse.seampact.ir.naming.NamingRole
import io.github.jubasse.seampact.ir.naming.segmentsOf
import javax.lang.model.element.Modifier

/** A final record per object schema, its members in declaration order, sensitive ones redacted. */
internal fun objectRecord(className: ClassName, schema: ObjectSchema, mapper: TypeMapper, layout: JavaLayout, refusals: Refusals): TypeSpec {
    val at = IrPlace.ROOT.below("schemas", schema.id)
    val names = MemberNames(at, refusals)
    val components = schema.properties.mapIndexedNotNull { index, property ->
        val name = names.claim(property.name, property.codeName, at.below("properties", index, "name")) ?: return@mapIndexedNotNull null

        RecordComponent(
            name = name,
            type = mapper.memberType(property.type, Presence.of(property.optional, property.nullable)),
            wireName = property.name,
            redacted = property.sensitive || property.type.isSensitive(),
            writtenAsString = property.type.isDecimal(),
        )
    }

    return generatedRecord(className, components, layout).build()
}

/**
 * A public record with the canonical constructor of [components] and its redacted `toString()`. `NON_ABSENT` keeps an
 * absent optional member absent on the wire whatever the app's mapper includes.
 */
internal fun generatedRecord(className: ClassName, components: List<RecordComponent>, layout: JavaLayout): TypeSpec.Builder =
    TypeSpec.recordBuilder(className)
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(AnnotationSpec.builder(JavaTypes.JSON_INCLUDE).addMember("value", "\$T.Include.NON_ABSENT", JavaTypes.JSON_INCLUDE).build())
        .recordConstructor(recordConstructor(components))
        .addMethod(redactedToString(className.simpleName(), components, layout.redaction))

/** An enum per enum declaration, each constant carrying its wire value. */
internal fun enumType(className: ClassName, declaration: Enum_, refusals: Refusals): TypeSpec {
    val at = IrPlace.ROOT.below("enums", declaration.id)
    val enum = TypeSpec.enumBuilder(className).addModifiers(Modifier.PUBLIC)
    val seen = HashSet<String>()

    declaration.values.forEachIndexed { index, value ->
        val segments = declaration.codeNames?.get(value)?.segments ?: segmentsOf(value, NameSource.ENUM_VALUE, position = index + 1)
        val constant = segments?.let { javaIdentifier(it, NamingRole.ENUM_MEMBER) }

        if (constant == null || !seen.add(constant)) {
            refusals.inconsistent("enum.value.name", "The enum value '$value' gives no Java constant, or one another value gives", at.below("values", index))
            return@forEachIndexed
        }

        val wire = AnnotationSpec.builder(JavaTypes.JSON_PROPERTY).addMember("value", "\$S", value).build()
        enum.addEnumConstant(constant, TypeSpec.anonymousClassBuilder("").addAnnotation(wire).build())
    }

    return enum.build()
}

/** The api's redaction constant: `seampact-hooks`'s own is package-private (ADR 0022 "Redaction"). */
internal fun redactionType(layout: JavaLayout): TypeSpec = TypeSpec.classBuilder(layout.redaction)
    .addModifiers(Modifier.PUBLIC, Modifier.FINAL)
    .addField(
        FieldSpec.builder(JavaTypes.STRING, "REDACTED", Modifier.PUBLIC, Modifier.STATIC, Modifier.FINAL)
            .initializer("\$S", "[redacted]")
            .build(),
    )
    .addMethod(MethodSpec.constructorBuilder().addModifiers(Modifier.PRIVATE).build())
    .build()

/** The member names of one record: each Java name once, a second one refused by name. */
internal class MemberNames(private val owner: IrPlace, private val refusals: Refusals) {
    private val claimed = HashSet<String>()

    fun claim(wireName: String, codeName: Name?, at: IrPlace): String? {
        val name = memberIdentifier(wireName, codeName)
        if (name == null) {
            refusals.inconsistent("member.no-segment", "The name '$wireName' yields no Java member name", at)
            return null
        }

        if (claimed.add(name)) return name

        refusals.add(
            SpringBootRefusal(
                code = "name.collision",
                message = "The Java member '$name' of ${owner.member} would be written for two members, the second '$wireName'.",
                fix = "Set a `codeName` on one of them in the contract.",
                member = at.member,
                operation = at.operation,
            ),
        )
        return null
    }
}
