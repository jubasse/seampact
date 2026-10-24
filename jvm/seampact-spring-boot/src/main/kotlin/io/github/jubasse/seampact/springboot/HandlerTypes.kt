package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.AnnotationSpec
import com.palantir.javapoet.ClassName
import com.palantir.javapoet.MethodSpec
import com.palantir.javapoet.TypeSpec
import io.github.jubasse.seampact.ir.model.HttpMethod
import io.github.jubasse.seampact.ir.model.Operation
import javax.lang.model.element.Modifier

private val REQUEST_MAPPING = ClassName.get("org.springframework.web.bind.annotation", "RequestMapping")
private val REQUEST_METHOD = ClassName.get("org.springframework.web.bind.annotation", "RequestMethod")
private val TARGET = ClassName.get("java.lang.annotation", "Target")
private val ELEMENT_TYPE = ClassName.get("java.lang.annotation", "ElementType")
private val RETENTION = ClassName.get("java.lang.annotation", "Retention")
private val RETENTION_POLICY = ClassName.get("java.lang.annotation", "RetentionPolicy")
private val DOCUMENTED = ClassName.get("java.lang.annotation", "Documented")

private const val PLACEHOLDER_START = '{'
private const val PLACEHOLDER_END = '}'
private const val PATTERN_WILDCARD = '*'

/**
 * The endpoints interface of each resource (ADR 0007 `handlers: perResource`): one synchronous method per operation,
 * taking its input record, returning its result and declaring the exception of every code it lists.
 */
internal fun endpointsTypes(layout: JavaLayout): List<TypeSpec> {
    val methods = LinkedHashMap<ClassName, MutableList<MethodSpec>>()

    for ((_, operation) in layout.kept.operations) {
        val names = layout.operation(operation.id)
        val method = MethodSpec.methodBuilder(names.method)
            .addModifiers(Modifier.PUBLIC, Modifier.ABSTRACT)
            .returns(names.result)
            .addParameter(names.input, "input")
            .addExceptions(operation.errors.map { it.code }.distinct().mapNotNull { layout.errorClass(it) })
            .build()
        methods.getOrPut(names.endpoints) { mutableListOf() } += method
    }

    return methods.map { (className, members) ->
        TypeSpec.interfaceBuilder(className)
            .addJavadoc("The handlers a controller implements; each returns a declared success or error, or throws a declared error.\n")
            .addModifiers(Modifier.PUBLIC)
            .addMethods(members)
            .build()
    }
}

/**
 * The composed annotation of an operation (ADR 0022 "Placement"): `@RequestMapping` with the method and the full
 * contract path, its variables positional, and the operation id and access kind as attributes the boundary reads.
 * It carries no `@ResponseStatus`, and no `@AliasFor` exposes anything that changes the route.
 */
internal fun composedAnnotation(layout: JavaLayout, operation: Operation, at: IrPlace, refusals: Refusals): TypeSpec? {
    val pattern = springPattern(operation.path, at.below("path"), refusals) ?: return null
    val method = requestMethod(operation.method) ?: return null

    return TypeSpec.annotationBuilder(layout.operation(operation.id).annotation)
        .addJavadoc("Maps a controller method to the contract operation '\$L'.\n", operation.id)
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(AnnotationSpec.builder(TARGET).addMember("value", "\$T.METHOD", ELEMENT_TYPE).build())
        .addAnnotation(AnnotationSpec.builder(RETENTION).addMember("value", "\$T.RUNTIME", RETENTION_POLICY).build())
        .addAnnotation(DOCUMENTED)
        .addAnnotation(
            AnnotationSpec.builder(REQUEST_MAPPING)
                .addMember("method", "\$T.\$L", REQUEST_METHOD, method)
                .addMember("path", "\$S", pattern)
                .build(),
        )
        .addMethod(attribute("operationId", operation.id))
        .addMethod(attribute("access", operation.access.kind))
        .build()
}

private fun attribute(name: String, value: String): MethodSpec = MethodSpec.methodBuilder(name)
    .addModifiers(Modifier.PUBLIC, Modifier.ABSTRACT)
    .returns(JavaTypes.STRING)
    .defaultValue("\$S", value)
    .build()

private fun requestMethod(method: HttpMethod): String? = when (method) {
    HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE -> method.value.uppercase(java.util.Locale.ROOT)
    else -> null
}

/**
 * The `PathPatternParser` pattern of a contract path: each `{name}` segment becomes `{p1}`, `{p2}`... in order, and a
 * static segment is kept as is (a `:` in it is literal). A static segment holding `{`, `}` or `*`, or a segment
 * mixing a placeholder with text, is refused by name (ADR 0022 "Routes").
 */
internal fun springPattern(path: String, at: IrPlace, refusals: Refusals): String? {
    var position = 0
    var refused = false
    val segments = path.split('/').map { segment ->
        val isPlaceholder = segment.length > 2 && segment.first() == PLACEHOLDER_START && segment.last() == PLACEHOLDER_END &&
            segment.count { it == PLACEHOLDER_START } == 1 && segment.count { it == PLACEHOLDER_END } == 1
        when {
            isPlaceholder -> {
                position += 1
                "{p$position}"
            }
            segment.any { it == PLACEHOLDER_START || it == PLACEHOLDER_END } && segment.contains(Regex("\\{[^/{}]+}")) -> {
                refused = true
                refusePath(refusals, at, "path.segment.mixed", "The segment '$segment' mixes a placeholder with literal text, which Spring's patterns do not read as the contract does")
                segment
            }
            segment.any { it == PLACEHOLDER_START || it == PLACEHOLDER_END || it == PATTERN_WILDCARD } -> {
                refused = true
                refusePath(refusals, at, "path.segment.literal", "The static segment '$segment' holds '{', '}' or '*', which Spring's patterns read as syntax")
                segment
            }
            else -> segment
        }
    }

    return if (refused) null else segments.joinToString("/")
}

private fun refusePath(refusals: Refusals, at: IrPlace, form: String, description: String) {
    refusals.add(
        SpringBootRefusal(
            code = "$form.unsupported",
            message = "$description, at ${at.member}.",
            fix = "Give the segment its own path parameter, or rename it without '{', '}' or '*'.",
            member = at.member,
            operation = at.operation,
        ),
    )
}
