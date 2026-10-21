package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.ClassName
import com.palantir.javapoet.FieldSpec
import com.palantir.javapoet.MethodSpec
import com.palantir.javapoet.TypeName
import com.palantir.javapoet.TypeSpec
import io.github.jubasse.seampact.ir.model.ErrorCode
import javax.lang.model.element.Modifier

private val OBJECTS: ClassName = ClassName.get("java.util", "Objects")
private const val SERIAL_VERSION = "serialVersionUID"

/**
 * The api's checked exception base and one final exception per error code the kept operations list (ADR 0012 "Errors
 * the handler answers"): a handler may throw one instead of returning its typed error result.
 */
internal class ContractExceptions(private val layout: JavaLayout, private val mapper: TypeMapper) {
    fun baseType(codes: Collection<ErrorCode>): TypeSpec = TypeSpec.classBuilder(layout.contractException)
        .addJavadoc("A contract error a handler throws; the boundary renders it in the api's format.\n")
        .addModifiers(Modifier.PUBLIC, Modifier.ABSTRACT, Modifier.SEALED)
        .superclass(ClassName.get("java.lang", "Exception"))
        .addPermittedSubclasses(codes.mapNotNull { layout.errorClass(it) })
        .addField(serialVersionField())
        .addMethod(
            MethodSpec.constructorBuilder()
                .addModifiers(Modifier.PROTECTED)
                .addParameter(JavaTypes.STRING, "code")
                .addStatement("super(code)")
                .build(),
        )
        .addMethod(abstractAccessor("code", JavaTypes.STRING, "The error code."))
        .addMethod(abstractAccessor("status", TypeName.INT, "The HTTP status the code answers."))
        .build()

    fun exceptionType(code: ErrorCode): TypeSpec? {
        val className = layout.errorClass(code) ?: return null
        val declaration = layout.ir.errors[code] ?: return null
        val paramsClass = declaration.params?.let { layout.schemaClass(it) }
        val components = listOfNotNull(paramsClass?.let { RecordComponent("params", it) })

        val exception = TypeSpec.classBuilder(className)
            .addModifiers(Modifier.PUBLIC, Modifier.FINAL)
            .superclass(layout.contractException)
            .addField(serialVersionField())
            .addMethod(constant("code", JavaTypes.STRING, "\$S", code))
            .addMethod(constant("status", TypeName.INT, "\$L", declaration.http.status))
            .addMethod(redactedToString(className.simpleName(), listOf(RecordComponent("code", JavaTypes.STRING)) + components, layout.redaction))
        val constructor = MethodSpec.constructorBuilder().addModifiers(Modifier.PUBLIC).addStatement("super(\$S)", code)

        if (paramsClass != null) {
            // Exceptions are serializable and the params record is not: the field is transient.
            exception.addField(FieldSpec.builder(paramsClass, "params", Modifier.PRIVATE, Modifier.FINAL, Modifier.TRANSIENT).build())
            exception.addMethod(MethodSpec.methodBuilder("params").addModifiers(Modifier.PUBLIC).returns(paramsClass).addStatement("return params").build())
            constructor.addParameter(mapper.schemaReference(paramsClass), "params")
            constructor.addStatement("this.params = \$T.requireNonNull(params, \$S)", OBJECTS, "params")
        }

        return exception.addMethod(constructor.build()).build()
    }

    private fun serialVersionField(): FieldSpec =
        FieldSpec.builder(TypeName.LONG, SERIAL_VERSION, Modifier.PRIVATE, Modifier.STATIC, Modifier.FINAL).initializer("1L").build()

    private fun abstractAccessor(name: String, type: TypeName, javadoc: String): MethodSpec =
        MethodSpec.methodBuilder(name).addJavadoc("$javadoc\n").addModifiers(Modifier.PUBLIC, Modifier.ABSTRACT).returns(type).build()

    private fun constant(name: String, type: TypeName, format: String, value: Any): MethodSpec = MethodSpec.methodBuilder(name)
        .addAnnotation(JavaTypes.OVERRIDE)
        .addModifiers(Modifier.PUBLIC)
        .returns(type)
        .addStatement("return $format", value)
        .build()
}
