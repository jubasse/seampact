package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.AnnotationSpec
import com.palantir.javapoet.ArrayTypeName
import com.palantir.javapoet.ClassName
import com.palantir.javapoet.CodeBlock
import com.palantir.javapoet.FieldSpec
import com.palantir.javapoet.MethodSpec
import com.palantir.javapoet.ParameterizedTypeName
import com.palantir.javapoet.TypeName
import com.palantir.javapoet.TypeSpec
import io.github.jubasse.seampact.ir.model.Access
import io.github.jubasse.seampact.ir.model.HttpMethod
import io.github.jubasse.seampact.ir.model.IdentityAccess
import io.github.jubasse.seampact.ir.model.Operation
import io.github.jubasse.seampact.ir.model.OptionalAccess
import io.github.jubasse.seampact.ir.model.PublicAccess
import io.github.jubasse.seampact.ir.model.RefusedCredential
import io.github.jubasse.seampact.ir.model.SignedIdentity
import io.github.jubasse.seampact.ir.naming.NamingRole
import javax.lang.model.element.Modifier

private val CONFIGURATION = ClassName.get("org.springframework.context.annotation", "Configuration")
private val BEAN = ClassName.get("org.springframework.context.annotation", "Bean")
private val ENVIRONMENT = ClassName.get("org.springframework.core.env", "Environment")
private val SPRING_HTTP_METHOD = ClassName.get("org.springframework.http", "HttpMethod")
private val REQUEST_MATCHER = ClassName.get("org.springframework.security.web.util.matcher", "RequestMatcher")
private val OR_REQUEST_MATCHER = ClassName.get("org.springframework.security.web.util.matcher", "OrRequestMatcher")
private val PATH_PATTERN_REQUEST_MATCHER = ClassName.get("org.springframework.security.web.servlet.util.matcher", "PathPatternRequestMatcher")
private val PATH_PATTERN_BUILDER = PATH_PATTERN_REQUEST_MATCHER.nestedClass("Builder")
private val CUSTOMIZER = ClassName.get("org.springframework.security.config", "Customizer")
private val HTTP_SECURITY = ClassName.get("org.springframework.security.config.annotation.web.builders", "HttpSecurity")

/** The Spring property whose servlet path the matchers take as their base path (ADR 0022 "Native security layers"). */
private const val SERVLET_PATH_PROPERTY = "spring.mvc.servlet.path"

/** The runtime class answering Spring Security's refusals, copied only with the Spring Security beans. */
internal const val SECURITY_REFUSALS = "SecurityRefusals"

/** The access kinds a matcher groups, in the order the matchers class declares them. */
private enum class AccessKind(val member: String, val description: String) {
    PUBLIC("publicRoutes", "the public operations"),
    OPTIONAL("optionalRoutes", "the optional-auth operations"),
    ANONYMOUS_ON_REFUSAL("anonymousOnRefusalRoutes", "the optional-auth operations whose refused credentials call anonymously"),
    IDENTITY("identityRoutes", "the operations that need a credential identity"),
    SIGNED("signedRoutes", "the operations a signed identity calls"),
}

private fun JavaLayout.securityMatchers(): ClassName = ClassName.get(springPackage, "${apiTypeName}SecurityMatchers")

/** The Spring Security configuration class of the api, imported by its boundary configuration. */
internal fun JavaLayout.securityConfiguration(): ClassName = ClassName.get(springPackage, "${apiTypeName}SecurityConfiguration")

/**
 * The api's Spring Security beans, in classes of their own so an app without Spring Security never compiles against
 * them (ADR 0022 "Native security layers"): the request matchers per access kind, the refusals in the api's format,
 * and with `springSecurity: { matchers: true }` the customizer that permits the public and optional-auth routes.
 */
internal fun securityTypes(layout: JavaLayout, mode: SpringSecurityMode, refusals: Refusals): List<TypeSpec> {
    if (mode == SpringSecurityMode.OFF) return emptyList()

    return listOf(matchersType(layout, refusals), securityConfigurationType(layout, mode))
}

private fun matchersType(layout: JavaLayout, refusals: Refusals): TypeSpec {
    val routesByKind = AccessKind.entries.associateWith { mutableListOf<CodeBlock>() }

    for ((index, operation) in layout.kept.operations) {
        val pattern = springPattern(operation.path, IrPlace.ofOperation(index, operation.id).below("path"), refusals) ?: continue
        val matchers = methodsOf(operation).map { method -> CodeBlock.of("routes.matcher(\$T.\$L, \$S)", SPRING_HTTP_METHOD, method, pattern) }

        for (kind in accessKindsOf(layout, operation.access)) routesByKind.getValue(kind) += matchers
    }

    val type = TypeSpec.classBuilder(layout.securityMatchers())
        .addJavadoc("The routes of the api '\$L' by access kind, for the app's own Spring Security rules, under the servlet path.\n", layout.ir.api.id)
        .addModifiers(Modifier.PUBLIC, Modifier.FINAL)

    val constructor = MethodSpec.constructorBuilder()
        .addModifiers(Modifier.PUBLIC)
        .addParameter(String::class.java, "servletPath")
        .addStatement("\$T routes = \$T.withDefaults()", PATH_PATTERN_BUILDER, PATH_PATTERN_REQUEST_MATCHER)
        .beginControlFlow("if (!servletPath.isEmpty() && !servletPath.equals(\"/\"))")
        .addStatement("routes = routes.basePath(servletPath)")
        .endControlFlow()

    for ((kind, matchers) in routesByKind) {
        type.addField(FieldSpec.builder(REQUEST_MATCHER, kind.member, Modifier.PRIVATE, Modifier.FINAL).build())
        constructor.addStatement("this.\$L = anyOf(\$L)", kind.member, CodeBlock.join(matchers, ", "))
        type.addMethod(
            MethodSpec.methodBuilder(kind.member)
                .addJavadoc("Matches \$L.\n", kind.description)
                .addModifiers(Modifier.PUBLIC)
                .returns(REQUEST_MATCHER)
                .addStatement("return \$L", kind.member)
                .build(),
        )
    }

    return type
        .addMethod(constructor.build())
        .addMethod(
            MethodSpec.methodBuilder("anyOf")
                .addModifiers(Modifier.PRIVATE, Modifier.STATIC)
                .addParameter(ArrayTypeName.of(REQUEST_MATCHER), "matchers")
                .varargs(true)
                .returns(REQUEST_MATCHER)
                .addStatement("if (matchers.length == 0) return request -> false")
                .addStatement("return new \$T(matchers)", OR_REQUEST_MATCHER)
                .build(),
        )
        .build()
}

// HEAD runs the path's GET operation (ADR 0022 "Routes"), so a GET route matches both.
private fun methodsOf(operation: Operation): List<String> {
    val method = operation.method.value.uppercase(java.util.Locale.ROOT)

    return if (operation.method == HttpMethod.GET) listOf(method, "HEAD") else listOf(method)
}

private fun accessKindsOf(layout: JavaLayout, access: Access): List<AccessKind> = when (access) {
    is PublicAccess -> listOf(AccessKind.PUBLIC)
    is OptionalAccess -> if (access.onRefused == RefusedCredential.ANONYMOUS) listOf(AccessKind.OPTIONAL, AccessKind.ANONYMOUS_ON_REFUSAL) else listOf(AccessKind.OPTIONAL)
    is IdentityAccess -> if (layout.ir.identities[access.identity] is SignedIdentity) listOf(AccessKind.SIGNED) else listOf(AccessKind.IDENTITY)
    // An unknown access kind is refused when the operations are read.
    is Access.Unknown -> emptyList()
}

private fun securityConfigurationType(layout: JavaLayout, mode: SpringSecurityMode): TypeSpec {
    val prefix = javaIdentifier(layout.ir.api.name.segments + listOf("security"), NamingRole.MEMBER)
    val matchers = layout.securityMatchers()
    val securityRefusals = layout.runtime(SECURITY_REFUSALS)

    val type = TypeSpec.classBuilder(layout.securityConfiguration())
        .addJavadoc("The Spring Security beans of the api '\$L'; the app wires the refusals in its own chain.\n", layout.ir.api.id)
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(AnnotationSpec.builder(CONFIGURATION).addMember("proxyBeanMethods", "false").build())
        .addMethod(
            securityBean("${prefix}Matchers", matchers)
                .addParameter(ENVIRONMENT, "environment")
                .addStatement("return new \$T(environment.getProperty(\$S, \"\"))", matchers, SERVLET_PATH_PROPERTY)
                .build(),
        )
        .addMethod(
            securityBean("${prefix}Refusals", securityRefusals)
                .addParameter(layout.runtime("SeampactBoundary"), "boundary")
                .addStatement("return new \$T(boundary)", securityRefusals)
                .build(),
        )

    if (mode == SpringSecurityMode.ON_WITH_MATCHERS) {
        type.addMethod(
            securityBean("${prefix}Customizer", ParameterizedTypeName.get(CUSTOMIZER, HTTP_SECURITY))
                .addJavadoc("Permits the public and optional-auth routes in every chain, before the app's own rules.\n")
                .addParameter(matchers, "matchers")
                .addStatement(
                    "return http -> http.authorizeHttpRequests(authorize -> authorize.requestMatchers(matchers.\$L(), matchers.\$L()).permitAll())",
                    AccessKind.PUBLIC.member,
                    AccessKind.OPTIONAL.member,
                )
                .build(),
        )
    }

    return type.build()
}

private fun securityBean(name: String, type: TypeName): MethodSpec.Builder = MethodSpec.methodBuilder(name)
    .addAnnotation(BEAN)
    .addModifiers(Modifier.PUBLIC)
    .returns(type)
