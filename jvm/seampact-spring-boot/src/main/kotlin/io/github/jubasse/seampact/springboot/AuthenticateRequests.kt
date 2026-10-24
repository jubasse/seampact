package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.ClassName
import com.palantir.javapoet.MethodSpec
import com.palantir.javapoet.ParameterizedTypeName
import com.palantir.javapoet.TypeName
import com.palantir.javapoet.TypeSpec
import io.github.jubasse.seampact.ir.model.CredentialIdentity
import io.github.jubasse.seampact.ir.model.IdentityId
import javax.lang.model.element.Modifier

private const val HOOKS_PACKAGE = "io.github.jubasse.seampact.hooks"
private val AUTHENTICATE_REQUEST = ClassName.get(HOOKS_PACKAGE, "AuthenticateRequest")
private val SIGNED_REQUEST = ClassName.get(HOOKS_PACKAGE, "SignedRequest")
private val REQUEST_VIEW = ClassName.get(HOOKS_PACKAGE, "RequestView")
private val OPERATION_REF = ClassName.get(HOOKS_PACKAGE, "OperationRef")

// The operation's extension values: untyped until an api declares extension keys (refused until then).
private val EXTENSIONS_TYPE: TypeName = ParameterizedTypeName.get(JavaTypes.MAP, JavaTypes.STRING, JavaTypes.OBJECT)

/**
 * The authenticate request of one credential identity and its credentials record (ADR 0022 "Options and
 * registration"): the request narrows `seampact-hooks`'s `AuthenticateRequest`, and its `toString()` never shows the
 * credentials or the CSRF token, nor the credentials record its members (ADR 0022 "Redaction").
 */
internal fun authenticateRequestTypes(layout: JavaLayout, identityId: IdentityId, refusals: Refusals): List<TypeSpec> {
    val identity = layout.ir.identities[identityId] as? CredentialIdentity ?: return emptyList()
    val names = layout.identity(identityId) ?: return emptyList()
    val at = IrPlace.ROOT.below("identities", identityId, "schemes")
    val memberNames = MemberNames(at, refusals)
    val optionalString = ParameterizedTypeName.get(JavaTypes.OPTIONAL, JavaTypes.STRING)

    val credentials = credentialSchemes(identity).mapNotNull { scheme ->
        memberNames.claim(scheme, null, IrPlace.ROOT.below("schemes", scheme))?.let { RecordComponent(it, optionalString, redacted = true) }
    }

    val requestComponents = listOf(
        RecordComponent("credentials", names.credentials, redacted = true),
        RecordComponent("csrfToken", optionalString, redacted = true),
        RecordComponent("request", REQUEST_VIEW),
        RecordComponent("operation", OPERATION_REF),
        RecordComponent("extensions", EXTENSIONS_TYPE),
    )

    val request = generatedRecord(names.request, requestComponents, layout)
        .addSuperinterface(ParameterizedTypeName.get(AUTHENTICATE_REQUEST, names.credentials, EXTENSIONS_TYPE))
        .addMethod(
            MethodSpec.methodBuilder("identity")
                .addAnnotation(JavaTypes.OVERRIDE)
                .addModifiers(Modifier.PUBLIC)
                .returns(JavaTypes.STRING)
                .addStatement("return \$S", identityId)
                .build(),
        )
        .addMethod(
            // A credential identity is never signed; a signed identity is refused until signed routes are generated.
            MethodSpec.methodBuilder("signature")
                .addAnnotation(JavaTypes.OVERRIDE)
                .addModifiers(Modifier.PUBLIC)
                .returns(ParameterizedTypeName.get(JavaTypes.OPTIONAL, SIGNED_REQUEST))
                .addStatement("return \$T.empty()", JavaTypes.OPTIONAL)
                .build(),
        )

    return listOf(generatedRecord(names.credentials, credentials, layout).build(), request.build())
}
