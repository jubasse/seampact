package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.CredentialIdentity
import io.github.jubasse.seampact.ir.model.HeaderDecl
import io.github.jubasse.seampact.ir.model.HeaderSemantic
import io.github.jubasse.seampact.ir.model.HeaderSide
import io.github.jubasse.seampact.ir.model.HeaderUseFor
import io.github.jubasse.seampact.ir.model.IdentityAccess
import io.github.jubasse.seampact.ir.model.IdentityHeaderUse
import io.github.jubasse.seampact.ir.model.IdentityId
import io.github.jubasse.seampact.ir.model.Operation
import io.github.jubasse.seampact.ir.model.OptionalAccess
import io.github.jubasse.seampact.ir.model.SignedIdentity

/**
 * A form the generated boundary validates but does not enforce, which the handler owes (ADR 0016 "Left to the
 * handler"): generation goes on, and the build prints it as a warning. [member] is a JSON Pointer into the IR;
 * [operation] is the id of the operation it is in.
 */
public data class SpringBootWarning(
    val code: String,
    val message: String,
    val fix: String,
    val member: String,
    val operation: String? = null,
)

/** The code of the warning on an identity's `headers`, the rights-version header among them. */
public const val IDENTITY_HEADERS_HANDLER: String = "identity.headers.handler"

/** The form of the refusal of an identity header the server would write on a response. */
public const val IDENTITY_RESPONSE_HEADER: String = "identity.response.header"

private const val IDENTITY_HEADERS_FIX = "Read the identity headers the boundary validated in the handler."

/**
 * One warning per operation whose identity declares request headers, as on the Node servers: the boundary validates
 * them as declared headers only, so the handler reads them.
 */
internal fun handlerFormWarnings(ir: ContractIR): List<SpringBootWarning> =
    ir.operations.mapIndexedNotNull { index, operation ->
        val headers = identityHeaders(ir, operation) ?: return@mapIndexedNotNull null
        if (headers.requestSideUses == 0) return@mapIndexedNotNull null
        val identityId = headers.identityId
        val place = IrPlace.ofOperation(index, operation.id).below("access")

        SpringBootWarning(
            code = IDENTITY_HEADERS_HANDLER,
            message = "The headers of the identity '$identityId' in operation '${operation.id}' at ${place.member} is not enforced by the generated boundary.",
            fix = IDENTITY_HEADERS_FIX,
            member = place.member,
            operation = place.operation,
        )
    }

/**
 * Refuses by name each identity header an operation would write on its responses, at the header's declaration: no
 * handler can write it, a result carrying only a body, so the boundary would drop it.
 */
internal fun refuseIdentityResponseHeaders(ir: ContractIR, refusals: Refusals) {
    for (operation in ir.operations) {
        val headers = identityHeaders(ir, operation) ?: continue

        for ((headerId, name) in headers.responseSide) {
            refusals.waiting(
                IDENTITY_RESPONSE_HEADER,
                "The response header '$name' of the identity '${headers.identityId}'",
                IrPlace("/headers/$headerId", operation.id),
                Delivery.AFTER_1_0,
            )
        }
    }
}

private data class IdentityHeaders(
    val identityId: IdentityId,
    val requestSideUses: Int,
    /** The name of each response-side header that applies to the operation, by header id. */
    val responseSide: Map<String, String>,
)

private fun identityHeaders(ir: ContractIR, operation: Operation): IdentityHeaders? {
    val identityId = when (val access = operation.access) {
        is IdentityAccess -> access.identity
        is OptionalAccess -> access.identity
        else -> return null
    }
    val uses = when (val identity = ir.identities[identityId]) {
        is CredentialIdentity -> identity.headers
        is SignedIdentity -> identity.headers
        else -> return null
    }

    if (uses.isEmpty()) return null

    var requestSideUses = 0
    val responseSide = LinkedHashMap<String, String>()

    for (use in uses) {
        val declaration = ir.headers[use.header]

        if (declaration == null || !isResponseSide(declaration)) {
            requestSideUses += 1
            continue
        }

        responseHeaderName(declaration, use, operation)?.let { responseSide[use.header] = it }
    }

    return IdentityHeaders(identityId, requestSideUses, responseSide)
}

private fun isResponseSide(declaration: HeaderDecl): Boolean =
    declaration.semantic == HeaderSemantic.VERSION_TOKEN || declaration.in_ == HeaderSide.RESPONSE

// A versionToken answers on every success of the identity; another semantic only where its `for` applies. An unknown
// `for` is taken to apply, so nothing is dropped unnamed.
private fun responseHeaderName(declaration: HeaderDecl, use: IdentityHeaderUse, operation: Operation): String? =
    when {
        declaration.semantic == HeaderSemantic.VERSION_TOKEN -> declaration.response
        use.for_ == HeaderUseFor.READS && !operation.safe -> null
        use.for_ == HeaderUseFor.WRITES && operation.safe -> null
        else -> declaration.name
    }
