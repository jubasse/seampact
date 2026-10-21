package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.ClassName
import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.CredentialIdentity
import io.github.jubasse.seampact.ir.model.EnumId
import io.github.jubasse.seampact.ir.model.ErrorCode
import io.github.jubasse.seampact.ir.model.IdentityAccess
import io.github.jubasse.seampact.ir.model.IdentityId
import io.github.jubasse.seampact.ir.model.Name
import io.github.jubasse.seampact.ir.model.Operation
import io.github.jubasse.seampact.ir.model.OptionalAccess
import io.github.jubasse.seampact.ir.model.SchemaId
import io.github.jubasse.seampact.ir.naming.IrName
import io.github.jubasse.seampact.ir.naming.NameSource
import io.github.jubasse.seampact.ir.naming.NamingLanguage
import io.github.jubasse.seampact.ir.naming.NamingRole
import io.github.jubasse.seampact.ir.naming.identifier
import io.github.jubasse.seampact.ir.naming.segmentsOf

/** The Java identifier of [segments] in [role] (ADR 0007 sections 4 and 5, Java column). */
internal fun javaIdentifier(segments: List<String>, role: NamingRole, status: Int? = null): String =
    identifier(IrName(segments, role, status), NamingLanguage.JAVA)

/** The member identifier of a wire name, or of its `codeName` when it has one. */
internal fun memberIdentifier(wireName: String, codeName: Name?): String? {
    val segments = codeName?.segments ?: segmentsOf(wireName, NameSource.NAME) ?: return null

    return javaIdentifier(segments, NamingRole.MEMBER)
}

/** The class names of one operation; the input parts exist when the operation declares them. */
internal data class OperationNames(
    val method: String,
    val input: ClassName,
    val path: ClassName,
    val query: ClassName,
    val headers: ClassName,
    val result: ClassName,
    val errors: ClassName,
    val annotation: ClassName,
    val endpoints: ClassName,
)

/** The class names of one identity's authenticate request and its credentials. */
internal data class IdentityNames(val request: ClassName, val credentials: ClassName)

/**
 * Every Java name the target writes for one api, computed once (ADR 0022 "Placement"): schema types under
 * `<package>.schemas`, the operation and hook types under `<package>`, the Spring placement under `<package>.spring`.
 * Two types of one package taking one name are refused by name.
 */
internal class JavaLayout(val ir: ContractIR, packageName: String, val kept: KeptForms, refusals: Refusals) {
    val operationsPackage: String = packageName
    val schemasPackage: String = "$packageName.schemas"
    val springPackage: String = "$packageName.spring"

    val apiTypeName: String = javaIdentifier(ir.api.name.segments, NamingRole.SCHEMA)

    val contractException: ClassName = ClassName.get(operationsPackage, "${apiTypeName}ContractException")
    val redaction: ClassName = ClassName.get(operationsPackage, "${apiTypeName}Redaction")

    private val schemaClasses = LinkedHashMap<SchemaId, ClassName>()
    private val enumClasses = LinkedHashMap<EnumId, ClassName>()
    private val errorClasses = LinkedHashMap<ErrorCode, ClassName>()
    private val errorArms = LinkedHashMap<ErrorCode, String>()
    private val operationNames = LinkedHashMap<String, OperationNames>()
    private val identityNames = LinkedHashMap<IdentityId, IdentityNames>()
    private val claimed = HashMap<String, String>()

    init {
        claim(contractException, "the api's contract exception base", IrPlace.ROOT.below("api", "name"), refusals)
        claim(redaction, "the api's redaction constant", IrPlace.ROOT.below("api", "name"), refusals)

        for (enumId in kept.enums) {
            val place = IrPlace.ROOT.below("enums", enumId, "name")
            val simpleName = typeIdentifier(ir.enums.getValue(enumId).name, place, refusals) ?: continue
            enumClasses[enumId] = ClassName.get(schemasPackage, simpleName).also { claim(it, "enum '$enumId'", place, refusals) }
        }

        for ((schemaId, schema) in kept.objects) {
            val place = IrPlace.ROOT.below("schemas", schemaId, "name")
            val simpleName = typeIdentifier(schema.name, place, refusals) ?: continue
            schemaClasses[schemaId] = ClassName.get(schemasPackage, simpleName).also { claim(it, "schema '$schemaId'", place, refusals) }
        }

        for (code in kept.errors) {
            val place = IrPlace.ROOT.below("errors", code)
            val segments = segmentsOf(code, NameSource.NAME)
            if (segments == null) {
                refusals.inconsistent("error.code.no-segment", "The error code '$code' yields no name segment", place)
                continue
            }
            errorClasses[code] = ClassName.get(operationsPackage, javaIdentifier(segments, NamingRole.ERROR))
                .also { claim(it, "the exception of error '$code'", place, refusals) }
            errorArms[code] = javaIdentifier(segments, NamingRole.SCHEMA)
        }

        for (identityId in kept.identities) {
            val place = IrPlace.ROOT.below("identities", identityId)
            val segments = segmentsOf(identityId, NameSource.NAME) ?: continue
            val names = IdentityNames(
                request = ClassName.get(operationsPackage, javaIdentifier(segments + listOf("authenticate", "request"), NamingRole.SCHEMA)),
                credentials = ClassName.get(operationsPackage, javaIdentifier(segments + "credentials", NamingRole.SCHEMA)),
            )
            claim(names.request, "the authenticate request of identity '$identityId'", place, refusals)
            claim(names.credentials, "the credentials of identity '$identityId'", place, refusals)
            identityNames[identityId] = names
        }

        val endpointsClaimed = HashSet<ClassName>()
        for ((index, operation) in kept.operations) {
            val place = IrPlace.ofOperation(index, operation.id).below("name")
            val names = operationNamesOf(operation)
            operationNames[operation.id] = names

            if (endpointsClaimed.add(names.endpoints)) claim(names.endpoints, "the endpoints interface '${names.endpoints.simpleName()}'", place, refusals)
            for (className in listOf(names.input, names.path, names.query, names.headers, names.result, names.errors, names.annotation)) {
                claim(className, "a type of operation '${operation.id}'", place, refusals)
            }
        }
    }

    fun schemaClass(schemaId: SchemaId): ClassName? = schemaClasses[schemaId]

    fun enumClass(enumId: EnumId): ClassName? = enumClasses[enumId]

    fun errorClass(code: ErrorCode): ClassName? = errorClasses[code]

    fun errorArm(code: ErrorCode): String? = errorArms[code]

    fun operation(operationId: String): OperationNames = operationNames.getValue(operationId)

    fun identity(identityId: IdentityId): IdentityNames? = identityNames[identityId]

    private fun operationNamesOf(operation: Operation): OperationNames {
        val segments = operation.name.segments
        val inOperations = { role: NamingRole -> ClassName.get(operationsPackage, javaIdentifier(segments, role)) }

        return OperationNames(
            method = javaIdentifier(segments, NamingRole.OPERATION),
            input = inOperations(NamingRole.INPUT),
            path = inOperations(NamingRole.PATH),
            query = inOperations(NamingRole.QUERY),
            headers = inOperations(NamingRole.HEADERS),
            result = ClassName.get(operationsPackage, javaIdentifier(segments + "result", NamingRole.SCHEMA)),
            errors = inOperations(NamingRole.ERRORS),
            annotation = ClassName.get(springPackage, javaIdentifier(segments, NamingRole.SCHEMA)),
            endpoints = ClassName.get(operationsPackage, javaIdentifier(endpointsOwner(operation), NamingRole.ENDPOINTS)),
        )
    }

    // A resource's operations share one interface; one without a resource joins its surface's, as on the Node targets.
    private fun endpointsOwner(operation: Operation): List<String> {
        val resourceType = operation.resource?.type
        if (resourceType != null) segmentsOf(resourceType, NameSource.NAME)?.let { return it }

        return ir.api.surfaces[operation.surface]?.name?.segments ?: segmentsOf(operation.surface, NameSource.NAME) ?: listOf("api")
    }

    private fun typeIdentifier(name: Name, place: IrPlace, refusals: Refusals): String? {
        val role = NamingRole.ofWire(name.role.value)
        if (role == null) {
            refusals.unknownValue(place.below("role"), name.role.value)
            return null
        }

        return try {
            javaIdentifier(name.segments, role, name.status?.toInt())
        } catch (error: IllegalArgumentException) {
            refusals.inconsistent("name.invalid", "The name is not one ADR 0007 builds an identifier from (${error.message})", place)
            null
        }
    }

    private fun claim(className: ClassName, owner: String, place: IrPlace, refusals: Refusals) {
        val previous = claimed.putIfAbsent(className.canonicalName(), owner) ?: return

        refusals.add(
            SpringBootRefusal(
                code = "name.collision",
                message = "The Java type '${className.canonicalName()}' would be written for both $previous and $owner.",
                fix = "Rename one of them in the contract (a schema name, an operation's `operationId` or a property's `codeName`).",
                member = place.member,
                operation = place.operation,
            ),
        )
    }
}

/** The identity an operation authenticates with, null on a public route. */
internal fun identityOf(operation: Operation): IdentityId? = when (val access = operation.access) {
    is IdentityAccess -> access.identity
    is OptionalAccess -> access.identity
    else -> null
}

/** The schemes whose credentials an identity reads, in declaration order without repeats. */
internal fun credentialSchemes(identity: CredentialIdentity): List<String> =
    (identity.schemes.read + identity.schemes.write + identity.schemes.optionalRead).distinct()
