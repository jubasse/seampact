package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.CredentialIdentity
import io.github.jubasse.seampact.ir.model.IdentityAccess
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

private const val IDENTITY_HEADERS_FIX = "Read the identity headers the boundary validated in the handler."

/**
 * One warning per operation whose identity declares headers, as on the Node servers: the boundary validates them as
 * declared headers only, so the handler compares the rights version and answers the stale-rights error.
 */
internal fun handlerFormWarnings(ir: ContractIR): List<SpringBootWarning> =
    ir.operations.mapIndexedNotNull { index, operation ->
        val identityId = identityWithHeaders(ir, operation) ?: return@mapIndexedNotNull null
        val place = IrPlace.ofOperation(index, operation.id).below("access")

        SpringBootWarning(
            code = IDENTITY_HEADERS_HANDLER,
            message = "The headers of the identity '$identityId' in operation '${operation.id}' at ${place.member} is not enforced by the generated boundary.",
            fix = IDENTITY_HEADERS_FIX,
            member = place.member,
            operation = place.operation,
        )
    }

private fun identityWithHeaders(ir: ContractIR, operation: Operation): IdentityId? {
    val identityId = when (val access = operation.access) {
        is IdentityAccess -> access.identity
        is OptionalAccess -> access.identity
        else -> return null
    }
    val headers = when (val identity = ir.identities[identityId]) {
        is CredentialIdentity -> identity.headers
        is SignedIdentity -> identity.headers
        else -> return null
    }

    return if (headers.isEmpty()) null else identityId
}
