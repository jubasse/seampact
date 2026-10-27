package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.AnnotationSpec
import com.palantir.javapoet.ClassName
import com.palantir.javapoet.CodeBlock
import com.palantir.javapoet.MethodSpec
import com.palantir.javapoet.ParameterSpec
import com.palantir.javapoet.ParameterizedTypeName
import com.palantir.javapoet.TypeName
import com.palantir.javapoet.TypeSpec
import com.palantir.javapoet.WildcardTypeName
import io.github.jubasse.seampact.ir.model.CredentialIdentity
import io.github.jubasse.seampact.ir.model.SchemaPrincipal
import io.github.jubasse.seampact.ir.model.SignedIdentity
import javax.lang.model.element.Modifier

private val CONFIGURATION = ClassName.get("org.springframework.context.annotation", "Configuration")
private val BEAN = ClassName.get("org.springframework.context.annotation", "Bean")
private val IMPORT = ClassName.get("org.springframework.context.annotation", "Import")
private val LISTABLE_BEAN_FACTORY = ClassName.get("org.springframework.beans.factory", "ListableBeanFactory")
private val OBJECT_PROVIDER = ClassName.get("org.springframework.beans.factory", "ObjectProvider")
private val QUALIFIER = ClassName.get("org.springframework.beans.factory.annotation", "Qualifier")
private val BEAN_POST_PROCESSOR = ClassName.get("org.springframework.beans.factory.config", "BeanPostProcessor")
private val ENVIRONMENT = ClassName.get("org.springframework.core.env", "Environment")
private val FILTER_REGISTRATION_BEAN = ClassName.get("org.springframework.boot.web.servlet", "FilterRegistrationBean")
private val DISPATCHER_TYPE = ClassName.get("jakarta.servlet", "DispatcherType")
private val WEB_MVC_CONFIGURER = ClassName.get("org.springframework.web.servlet.config.annotation", "WebMvcConfigurer")
private val JSON_NODE = JavaTypes.JSON_NODE
private val JSON_MAPPER = ClassName.get("tools.jackson.databind.json", "JsonMapper")
private val ANNOTATION = ClassName.get("java.lang.annotation", "Annotation")
private val CLASS = ClassName.get("java.lang", "Class")
private val THROWABLE = ClassName.get("java.lang", "Throwable")
private val INTEGER = ClassName.get("java.lang", "Integer")
private val HOOKS_PACKAGE = "io.github.jubasse.seampact.hooks"
private val AUTHENTICATE_HOOK = ClassName.get(HOOKS_PACKAGE, "AuthenticateHook")
private val AUTHENTICATE_RESULT = ClassName.get(HOOKS_PACKAGE, "AuthenticateResult")
private val REQUEST_VIEW = ClassName.get(HOOKS_PACKAGE, "RequestView")
private val OPERATION_REF = ClassName.get(HOOKS_PACKAGE, "OperationRef")

private val ANY_CLASS: TypeName = ParameterizedTypeName.get(CLASS, WildcardTypeName.subtypeOf(JavaTypes.OBJECT))
private val ANNOTATION_CLASS: TypeName = ParameterizedTypeName.get(CLASS, WildcardTypeName.subtypeOf(ANNOTATION))

/**
 * The authenticate hook interface of each identity the kept operations read (ADR 0022 "Options and registration"):
 * the app's hook bean implements it, narrowed by the identity's request record and principal.
 */
internal fun authenticateHookTypes(layout: JavaLayout): List<TypeSpec> = layout.kept.identities.mapNotNull { identityId ->
    val principal = when (val identity = layout.ir.identities[identityId]) {
        is CredentialIdentity -> identity.principal
        is SignedIdentity -> identity.principal
        else -> return@mapNotNull null
    }
    val names = layout.identity(identityId) ?: return@mapNotNull null
    val principalSchema = (principal as? SchemaPrincipal)?.schema ?: return@mapNotNull null
    val principalClass = layout.schemaClass(principalSchema) ?: return@mapNotNull null

    TypeSpec.interfaceBuilder(names.hook)
        .addJavadoc("The authenticate hook of the identity '\$L': register one bean implementing it.\n", identityId)
        .addModifiers(Modifier.PUBLIC)
        .addSuperinterface(ParameterizedTypeName.get(AUTHENTICATE_HOOK, names.request, principalClass, layout.runtime("Denial")))
        .build()
}

/**
 * The api's own interfaces of the runtime's hook types (ADR 0025 "The runtime packages"): two apis share the runtime,
 * so each boundary calls only the deciders, scope resolvers and unexpected-error listeners implementing its own.
 */
internal fun apiHookTypes(layout: JavaLayout): List<TypeSpec> = listOf(
    apiHookType(layout.decider, layout.runtime("Decider"), "decide hook", layout),
    apiHookType(layout.scopeResolver, layout.runtime("ScopeResolver"), "scope resolver", layout),
    apiHookType(layout.unexpectedErrorListener, layout.runtime("UnexpectedErrorListener"), "unexpected-error listener", layout),
)

private fun apiHookType(apiType: ClassName, runtimeType: ClassName, hook: String, layout: JavaLayout): TypeSpec =
    TypeSpec.interfaceBuilder(apiType)
        .addJavadoc("The \$L of the api '\$L': its boundary calls the beans implementing this interface, never another api's.\n", hook, layout.ir.api.id)
        .addModifiers(Modifier.PUBLIC)
        .addSuperinterface(runtimeType)
        .build()

/** What the runtime needs to know of the api's Java types: inputs, annotations, result arms, exceptions, hooks. */
internal fun bindingType(layout: JavaLayout): TypeSpec {
    val operations = layout.kept.operations.map { (_, operation) -> operation }

    val inputs = mapEntries(operations.map { CodeBlock.of("\$S, \$T.class", it.id, layout.operation(it.id).input) })
    val annotations = mapEntries(operations.map { CodeBlock.of("\$S, \$T.class", it.id, layout.operation(it.id).annotation) })
    val successArms = mapEntries(operations.flatMap { operation ->
        operation.responses.filter { it.derivedFrom?.derivation != ETAG_DERIVATION }.map { response ->
            CodeBlock.of("\$T.class, \$L", layout.operation(operation.id).result.nestedClass(STATUS_ARM_PREFIX + response.status), response.status)
        }
    })
    val errorArms = mapEntries(operations.flatMap { operation ->
        operation.errors.map { it.code }.distinct().mapNotNull { code ->
            layout.errorArm(code)?.let { arm -> CodeBlock.of("\$T.class, \$S", layout.operation(operation.id).errors.nestedClass(arm), code) }
        }
    })
    val identities = layout.kept.identities.mapNotNull { identityId -> layout.identity(identityId)?.let { identityId to it } }
    val hooks = mapEntries(identities.map { (identityId, names) -> CodeBlock.of("\$S, \$T.class", identityId, names.hook) })

    val binding = TypeSpec.classBuilder(layout.binding)
        .addJavadoc("The Java types of the api '\$L' its boundary runtime reads.\n", layout.ir.api.id)
        .addModifiers(Modifier.PUBLIC, Modifier.FINAL)
        .addSuperinterface(layout.runtime("ApiBinding"))
        .addMethod(mapMethod("inputTypes", JavaTypes.STRING, ANY_CLASS, inputs))
        .addMethod(mapMethod("annotations", JavaTypes.STRING, ANNOTATION_CLASS, annotations))
        .addMethod(mapMethod("successArms", ANY_CLASS, INTEGER, successArms))
        .addMethod(mapMethod("errorArms", ANY_CLASS, JavaTypes.STRING, errorArms))
        .addMethod(mapMethod("authenticateHooks", JavaTypes.STRING, ANY_CLASS, hooks))
        .addMethod(hookTypeMethod("deciderType", layout.runtime("Decider"), layout.decider))
        .addMethod(hookTypeMethod("scopeResolverType", layout.runtime("ScopeResolver"), layout.scopeResolver))
        .addMethod(hookTypeMethod("unexpectedErrorListenerType", layout.runtime("UnexpectedErrorListener"), layout.unexpectedErrorListener))
        .addMethod(
            MethodSpec.methodBuilder("generatorVersion")
                .addAnnotation(Override::class.java)
                .addModifiers(Modifier.PUBLIC)
                .returns(JavaTypes.STRING)
                .addStatement("return \$S", SpringBootTarget.VERSION)
                .build(),
        )
        .addMethod(contractCodeMethod(layout))
        .addMethod(authenticateMethod(layout, identities))
    if (usesSpringPages(layout)) springPageMethods(layout).forEach(binding::addMethod)

    return binding.build()
}

private fun hookTypeMethod(name: String, runtimeType: ClassName, apiType: ClassName): MethodSpec = MethodSpec.methodBuilder(name)
    .addAnnotation(Override::class.java)
    .addModifiers(Modifier.PUBLIC)
    .returns(ParameterizedTypeName.get(CLASS, WildcardTypeName.subtypeOf(runtimeType)))
    .addStatement("return \$T.class", apiType)
    .build()

// The Spring Data bridge of an api with a `springPage` list: only its binding and `SpringDataPages` name Spring Data
// types, so an app without such a list needs no Spring Data on its classpath.
private fun springPageMethods(layout: JavaLayout): List<MethodSpec> {
    val springDataPages = layout.runtime(SPRING_DATA_PAGES)
    val springPageLists = layout.kept.operations.map { (_, operation) -> operation }.filter { isSpringPageList(layout.ir, it) }
    val sortProperties = mapEntries(springPageLists.map { operation ->
        val members = springSortProperties(layout.ir, operation).mapNotNull { (key, member) -> member?.let { CodeBlock.of("\$S, \$S", key, it) } }
        CodeBlock.of("\$S, \$L", operation.id, mapExpression(members))
    })

    return listOf(
        MethodSpec.methodBuilder("pageable")
            .addAnnotation(Override::class.java)
            .addModifiers(Modifier.PUBLIC)
            .returns(JavaTypes.OBJECT)
            .addParameter(JavaTypes.STRING, "operationId")
            .addParameter(JSON_NODE, "style")
            .addParameter(JSON_NODE, "query")
            .addStatement("return \$T.pageable(style, query, springSortProperties().get(operationId))", springDataPages)
            .build(),
        MethodSpec.methodBuilder("springSortProperties")
            .addJavadoc("The Java member each sort key of a springPage list names, by operation id.\n")
            .addModifiers(Modifier.PRIVATE, Modifier.STATIC)
            .returns(ParameterizedTypeName.get(JavaTypes.MAP, JavaTypes.STRING, ParameterizedTypeName.get(JavaTypes.MAP, JavaTypes.STRING, JavaTypes.STRING)))
            .addCode(sortProperties)
            .build(),
        MethodSpec.methodBuilder("pageFacts")
            .addAnnotation(Override::class.java)
            .addModifiers(Modifier.PUBLIC)
            .returns(JavaTypes.OBJECT)
            .addParameter(JavaTypes.OBJECT, "body")
            .addStatement("return \$T.facts(body)", springDataPages)
            .build(),
    )
}

private fun mapEntries(entries: List<CodeBlock>): CodeBlock = CodeBlock.of("return \$L;\n", mapExpression(entries))

private fun mapExpression(entries: List<CodeBlock>): CodeBlock {
    if (entries.isEmpty()) return CodeBlock.of("\$T.of()", JavaTypes.MAP)

    val code = CodeBlock.builder().add("\$T.ofEntries(", JavaTypes.MAP)
    entries.forEachIndexed { index, entry -> code.add(if (index == 0) "\n\$T.entry(\$L)" else ",\n\$T.entry(\$L)", JavaTypes.MAP, entry) }

    return code.add(")").build()
}

private fun mapMethod(name: String, key: TypeName, value: TypeName, body: CodeBlock): MethodSpec = MethodSpec.methodBuilder(name)
    .addAnnotation(Override::class.java)
    .addModifiers(Modifier.PUBLIC)
    .returns(ParameterizedTypeName.get(JavaTypes.MAP, key, value))
    .addCode(body)
    .build()

private fun contractCodeMethod(layout: JavaLayout): MethodSpec {
    val method = MethodSpec.methodBuilder("contractCode")
        .addAnnotation(Override::class.java)
        .addModifiers(Modifier.PUBLIC)
        .returns(ParameterizedTypeName.get(JavaTypes.OPTIONAL, JavaTypes.STRING))
        .addParameter(THROWABLE, "exception")

    return if (layout.kept.errors.isEmpty()) {
        method.addStatement("return \$T.empty()", JavaTypes.OPTIONAL).build()
    } else {
        method.addStatement("return exception instanceof \$T contract ? \$T.of(contract.code()) : \$T.empty()", layout.contractException, JavaTypes.OPTIONAL, JavaTypes.OPTIONAL).build()
    }
}

private fun authenticateMethod(layout: JavaLayout, identities: List<Pair<String, IdentityNames>>): MethodSpec {
    val denial = layout.runtime("Denial")
    val method = MethodSpec.methodBuilder("authenticate")
        .addAnnotation(Override::class.java)
        .addModifiers(Modifier.PUBLIC)
        .returns(ParameterizedTypeName.get(AUTHENTICATE_RESULT, WildcardTypeName.subtypeOf(JavaTypes.OBJECT), denial))
        .addParameter(JavaTypes.STRING, "identity")
        .addParameter(LISTABLE_BEAN_FACTORY, "beans")
        .addParameter(JSON_MAPPER, "mapper")
        .addParameter(JSON_NODE, "credentials")
        .addParameter(ParameterizedTypeName.get(JavaTypes.OPTIONAL, JavaTypes.STRING), "csrfToken")
        .addParameter(ParameterizedTypeName.get(JavaTypes.OPTIONAL, SIGNED_TEMPLATE_REQUEST), "signature")
        .addParameter(REQUEST_VIEW, "request")
        .addParameter(OPERATION_REF, "operation")

    val unknown = CodeBlock.of(
        "throw new \$T(\"seampact: the identity '\" + identity + \"' is not one the operations of the api '\$L' authenticate with\")",
        IllegalArgumentException::class.java, layout.ir.api.id,
    )
    if (identities.isEmpty()) return method.addStatement(unknown).build()

    val code = CodeBlock.builder().add("return switch (identity) {\n").indent()
    for ((identityId, names) in identities) {
        val signatureArgument = if (layout.ir.identities[identityId] is SignedIdentity) "signature, " else ""
        code.add(
            "case \$S -> beans.getBean(\$T.class).authenticate(new \$T(mapper.treeToValue(credentials, \$T.class), csrfToken, \$Lrequest, operation, \$T.of()));\n",
            identityId, names.hook, names.request, names.credentials, signatureArgument, JavaTypes.MAP,
        )
    }
    code.add("default -> \$L;\n", unknown).unindent().add("};\n")

    return method.addCode(code.build()).build()
}

/**
 * The api's registration (ADR 0022 "Options and registration"): one `@Configuration` class with the boundary, its
 * filter, its MVC pieces, the reply handler placed first and the boot check. It uses no `@Profile` or
 * `@ConditionalOnProperty`, so AOT and native builds behave as the JVM build does.
 */
internal fun configurationType(layout: JavaLayout, springSecurity: SpringSecurityMode): TypeSpec {
    val boundary = layout.runtime("SeampactBoundary")
    val filter = layout.runtime("BoundaryFilter")
    val prefix = registrationPrefix(layout)
    val registration = ParameterizedTypeName.get(FILTER_REGISTRATION_BEAN, filter)

    return TypeSpec.classBuilder(layout.configuration)
        .addJavadoc("Registers the boundary of the api '\$L'; import it, or let component scan find it.\n", layout.ir.api.id)
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(AnnotationSpec.builder(CONFIGURATION).addMember("proxyBeanMethods", "false").build())
        .apply {
            if (springSecurity != SpringSecurityMode.OFF) {
                addAnnotation(AnnotationSpec.builder(IMPORT).addMember("value", "\$T.class", layout.securityConfiguration()).build())
            }
        }
        .addMethod(
            bean(boundaryBeanName(layout), boundary)
                .addParameter(LISTABLE_BEAN_FACTORY, "beans")
                .addParameter(ENVIRONMENT, "environment")
                .addStatement("return new \$T(\$T.json(), new \$T(), beans, environment)", boundary, layout.contractTable, layout.binding)
                .build(),
        )
        .addMethod(
            bean("${prefix}Filter", registration)
                .addParameter(boundaryParameter(layout, boundary))
                .addStatement("\$T registration = new \$T<>(new \$T(boundary))", registration, FILTER_REGISTRATION_BEAN, filter)
                .addStatement("registration.setOrder(\$T.ORDER)", filter)
                .addStatement("registration.setDispatcherTypes(\$T.REQUEST, \$T.ASYNC)", DISPATCHER_TYPE, DISPATCHER_TYPE)
                .addStatement("registration.setName(\$S)", "${prefix}Filter")
                .addStatement("return registration")
                .build(),
        )
        .addMethod(
            bean("${prefix}Mvc", WEB_MVC_CONFIGURER)
                .addParameter(boundaryParameter(layout, boundary))
                .addStatement("return new \$T(boundary)", layout.runtime("BoundaryMvcConfigurer"))
                .build(),
        )
        .addMethod(
            bean("${prefix}ReplyHandlerFirst", BEAN_POST_PROCESSOR)
                .addModifiers(Modifier.STATIC)
                .addParameter(boundaryParameter(layout, ParameterizedTypeName.get(OBJECT_PROVIDER, boundary)))
                .addStatement("return new \$T(boundary)", layout.runtime("ReplyHandlerFirst"))
                .build(),
        )
        .addMethod(
            bean("${prefix}BootCheck", layout.runtime("BootCheck"))
                .addParameter(boundaryParameter(layout, boundary))
                .addStatement("return new \$T(boundary)", layout.runtime("BootCheck"))
                .build(),
        )
        .build()
}

private fun registrationPrefix(layout: JavaLayout): String =
    javaIdentifier(layout.ir.api.name.segments + listOf("seampact"), io.github.jubasse.seampact.ir.naming.NamingRole.MEMBER)

private fun boundaryBeanName(layout: JavaLayout): String = "${registrationPrefix(layout)}Boundary"

/**
 * A bean method's parameter that takes the api's boundary bean by its name: every api's boundary is a
 * `SeampactBoundary` of the shared runtime, so a parameter matched by type alone would find two.
 */
internal fun boundaryParameter(layout: JavaLayout, type: TypeName): ParameterSpec = ParameterSpec.builder(type, "boundary")
    .addAnnotation(AnnotationSpec.builder(QUALIFIER).addMember("value", "\$S", boundaryBeanName(layout)).build())
    .build()

private fun bean(name: String, type: TypeName): MethodSpec.Builder = MethodSpec.methodBuilder(name)
    .addAnnotation(BEAN)
    .addModifiers(Modifier.PUBLIC)
    .returns(type)
