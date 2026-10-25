package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.AnnotationSpec
import com.palantir.javapoet.ClassName
import com.palantir.javapoet.CodeBlock
import com.palantir.javapoet.FieldSpec
import com.palantir.javapoet.MethodSpec
import com.palantir.javapoet.ParameterizedTypeName
import com.palantir.javapoet.TypeName
import com.palantir.javapoet.TypeSpec
import io.github.jubasse.seampact.ir.model.Access
import io.github.jubasse.seampact.ir.model.IdentityAccess
import io.github.jubasse.seampact.ir.model.OptionalAccess
import io.github.jubasse.seampact.ir.model.PublicAccess
import io.github.jubasse.seampact.ir.model.RefusedCredential
import io.github.jubasse.seampact.ir.model.SignedIdentity
import io.github.jubasse.seampact.ir.naming.NamingRole
import javax.lang.model.element.Modifier

private val CONFIGURATION = ClassName.get("org.springframework.context.annotation", "Configuration")
private val BEAN = ClassName.get("org.springframework.context.annotation", "Bean")
private val ORDER = ClassName.get("org.springframework.core.annotation", "Order")
private val ORDERED = ClassName.get("org.springframework.core", "Ordered")
private val REQUEST_MATCHER = ClassName.get("org.springframework.security.web.util.matcher", "RequestMatcher")
private val CUSTOMIZER = ClassName.get("org.springframework.security.config", "Customizer")
private val HTTP_SECURITY = ClassName.get("org.springframework.security.config.annotation.web.builders", "HttpSecurity")
private val STRING_SET = ParameterizedTypeName.get(ClassName.get(Set::class.java), JavaTypes.STRING)

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
 * and with `springSecurity: { matchers: true }` the customizer that permits the public, optional-auth and signed routes.
 */
internal fun securityTypes(layout: JavaLayout, mode: SpringSecurityMode): List<TypeSpec> {
    if (mode == SpringSecurityMode.OFF) return emptyList()

    return listOf(matchersType(layout), securityConfigurationType(layout, mode))
}

// Each kind matches by the operation the boundary filter matched, its most specific route, so a template of one kind
// never covers a literal sibling of another (ADR 0022 "Native security layers").
private fun matchersType(layout: JavaLayout): TypeSpec {
    val operationIdsByKind = AccessKind.entries.associateWith { mutableListOf<CodeBlock>() }

    for ((_, operation) in layout.kept.operations) {
        for (kind in accessKindsOf(layout, operation.access)) operationIdsByKind.getValue(kind) += CodeBlock.of("\$S", operation.id)
    }

    val boundary = layout.runtime("SeampactBoundary")
    val type = TypeSpec.classBuilder(layout.securityMatchers())
        .addJavadoc(
            "The routes of the api '\$L' by access kind, for the app's own Spring Security rules: each matches the operation the\n" +
                "boundary filter matched, so it needs that filter before Spring Security's chain, as the boot check makes sure.\n",
            layout.ir.api.id,
        )
        .addModifiers(Modifier.PUBLIC, Modifier.FINAL)

    val constructor = MethodSpec.constructorBuilder()
        .addModifiers(Modifier.PUBLIC)
        .addParameter(boundary, "boundary")

    for ((kind, operationIds) in operationIdsByKind) {
        type.addField(FieldSpec.builder(REQUEST_MATCHER, kind.member, Modifier.PRIVATE, Modifier.FINAL).build())
        constructor.addStatement("this.\$L = operations(boundary, \$T.of(\$L))", kind.member, Set::class.java, CodeBlock.join(operationIds, ", "))
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
            MethodSpec.methodBuilder("operations")
                .addModifiers(Modifier.PRIVATE, Modifier.STATIC)
                .addParameter(boundary, "boundary")
                .addParameter(STRING_SET, "operationIds")
                .returns(REQUEST_MATCHER)
                .addStatement("return request -> boundary.operationIdOf(request).filter(operationIds::contains).isPresent()")
                .build(),
        )
        .build()
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
    val boundary = layout.runtime("SeampactBoundary")
    val securityRefusals = layout.runtime(SECURITY_REFUSALS)

    val type = TypeSpec.classBuilder(layout.securityConfiguration())
        .addJavadoc("The Spring Security beans of the api '\$L'; the app wires the refusals in its own chain.\n", layout.ir.api.id)
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(AnnotationSpec.builder(CONFIGURATION).addMember("proxyBeanMethods", "false").build())
        .addMethod(
            securityBean("${prefix}Matchers", matchers)
                .addParameter(boundary, "boundary")
                .addStatement("return new \$T(boundary)", matchers)
                .build(),
        )
        .addMethod(
            securityBean("${prefix}Refusals", securityRefusals)
                .addParameter(boundary, "boundary")
                .addStatement("return new \$T(boundary)", securityRefusals)
                .build(),
        )

    if (mode == SpringSecurityMode.ON_WITH_MATCHERS) {
        type.addMethod(
            securityBean("${prefix}Customizer", ParameterizedTypeName.get(CUSTOMIZER, HTTP_SECURITY))
                .addJavadoc(
                    "Permits the public, optional-auth and signed routes in every chain, before the app's own rules and, being\n" +
                        "ordered first, before the app's own customizers; the boundary checks the signature of a signed route.\n",
                )
                .addAnnotation(AnnotationSpec.builder(ORDER).addMember("value", "\$T.HIGHEST_PRECEDENCE", ORDERED).build())
                .addParameter(matchers, "matchers")
                .addStatement(
                    "return http -> http.authorizeHttpRequests(authorize -> authorize.requestMatchers(matchers.\$L(), matchers.\$L(), matchers.\$L()).permitAll())",
                    AccessKind.PUBLIC.member,
                    AccessKind.OPTIONAL.member,
                    AccessKind.SIGNED.member,
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
