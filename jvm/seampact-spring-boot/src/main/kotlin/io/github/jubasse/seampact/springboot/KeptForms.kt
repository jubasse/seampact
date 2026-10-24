package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.ArrayTypeUse
import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.CredentialIdentity
import io.github.jubasse.seampact.ir.model.DerivedIdempotency
import io.github.jubasse.seampact.ir.model.EnumId
import io.github.jubasse.seampact.ir.model.EnumTypeUse
import io.github.jubasse.seampact.ir.model.ErrorCode
import io.github.jubasse.seampact.ir.model.ExemptIdempotency
import io.github.jubasse.seampact.ir.model.FileTypeUse
import io.github.jubasse.seampact.ir.model.HttpMethod
import io.github.jubasse.seampact.ir.model.IdentityId
import io.github.jubasse.seampact.ir.model.MapSchema
import io.github.jubasse.seampact.ir.model.ObjectSchema
import io.github.jubasse.seampact.ir.model.OpaqueTypeUse
import io.github.jubasse.seampact.ir.model.Operation
import io.github.jubasse.seampact.ir.model.RefTypeUse
import io.github.jubasse.seampact.ir.model.ResponseShape
import io.github.jubasse.seampact.ir.model.RuleRequirement
import io.github.jubasse.seampact.ir.model.ScalarType
import io.github.jubasse.seampact.ir.model.ScalarTypeUse
import io.github.jubasse.seampact.ir.model.SchemaId
import io.github.jubasse.seampact.ir.model.SchemaPrincipal
import io.github.jubasse.seampact.ir.model.SignedIdentity
import io.github.jubasse.seampact.ir.model.TypeUse
import io.github.jubasse.seampact.ir.model.UnionSchema
import io.github.jubasse.seampact.ir.model.UnknownKeysPolicy
import io.github.jubasse.seampact.ir.model.UrlForm

private const val JSON_MEDIA = "application/json"
private val SPRING_4_MEDIA = listOf("application/x-www-form-urlencoded", "multipart/form-data")
private const val SPRING_PACK = "spring"
private const val INT64_FORMAT = "int64"
/** The derivation of the 304 an ETag answers: the boundary's, never the handler's. */
internal const val ETAG_DERIVATION = "cache.etag"
private val PAYLOAD_SHAPES = listOf(ResponseShape.ITEM, ResponseShape.TABLE, ResponseShape.LIST)

/**
 * What one api's generation reads from its kept operations (ADR 0022 "Refused by name or waiting"): the operations,
 * and the object schemas, enums, error codes and identities they reach. A form no kept operation carries is neither
 * generated nor refused; a kept form this release does not generate is refused by name with the release that brings it.
 */
internal class KeptForms(private val ir: ContractIR, private val refusals: Refusals) {
    val operations: List<Pair<Int, Operation>> = ir.operations.withIndex().map { (index, operation) -> index to operation }
    val objects = LinkedHashMap<SchemaId, ObjectSchema>()
    val enums = LinkedHashSet<EnumId>()
    val errors = LinkedHashSet<ErrorCode>()
    val identities = LinkedHashSet<IdentityId>()

    init {
        checkApiForms()
        for ((index, operation) in operations) readOperation(operation, IrPlace.ofOperation(index, operation.id))
    }

    private fun checkApiForms() {
        if (ir.api.wire.urls != UrlForm.RELATIVE) {
            refusals.waiting("wire.urls", "'api.wire.urls: ${ir.api.wire.urls.value}'", IrPlace.ROOT.below("api", "wire", "urls"), Delivery.SPRING_3)
        }

        ir.packs.forEachIndexed { index, pack ->
            if (pack.name == SPRING_PACK) refusals.waiting("pack.spring", "The 'pack:spring' profile", IrPlace.ROOT.below("packs", index), Delivery.SPRING_3)
        }

        if (ir.extensionKeys.isNotEmpty()) {
            refusals.waiting("extensionKeys", "Typed extension values", IrPlace.ROOT.below("extensionKeys"), Delivery.AFTER_1_0)
        }
    }

    private fun readOperation(operation: Operation, at: IrPlace) {
        checkOperationForms(operation, at)

        if (operation.method is HttpMethod.Unknown) refusals.unknownValue(at.below("method"), operation.method.value)

        listOf("path" to operation.params.path, "query" to operation.params.query, "header" to operation.params.header).forEach { (location, params) ->
            params.forEachIndexed { index, param ->
                val paramAt = at.below("params", location, index)
                if (param.default != null) refusals.waiting("param.default", "A parameter default", paramAt.below("default"), Delivery.AFTER_1_0)
                readType(param.type, paramAt.below("type"))
            }
        }

        operation.input?.let { input ->
            if (input.media.value != JSON_MEDIA) {
                val delivery = if (input.media.value in SPRING_4_MEDIA) Delivery.SPRING_4 else Delivery.AFTER_1_0
                refusals.waiting("input.media", "A '${input.media.value}' body", at.below("input", "media"), delivery)
            }
            if (!input.proofs.isNullOrEmpty()) refusals.waiting("input.proofs", "Rule proof fields in the body", at.below("input", "proofs"), Delivery.SPRING_3)
            readType(input.schema, at.below("input", "schema"))
        }

        operation.responses.indices.forEach { index -> readResponse(operation, index, at) }

        operation.errors.forEachIndexed { index, error -> readError(error.code, at.below("errors", index, "code")) }

        identityOf(operation)?.let { identityId -> readIdentity(identityId, at.below("access", "identity")) }
    }

    private fun checkOperationForms(operation: Operation, at: IrPlace) {
        if (operation.paging != null) refusals.waiting("paging", "Paging", at.below("paging"), Delivery.SPRING_3)
        if (operation.cache != null) refusals.waiting("cache", "Cache and ETag headers", at.below("cache"), Delivery.SPRING_3)
        if (operation.concurrency != null) refusals.waiting("concurrency", "A version token (concurrency)", at.below("concurrency"), Delivery.SPRING_3)

        when (val idempotency = operation.idempotency) {
            null, is ExemptIdempotency -> Unit
            is DerivedIdempotency -> refusals.waiting("idempotency", "Idempotency replay", at.below("idempotency"), Delivery.SPRING_3)
            else -> refusals.unknownValue(at.below("idempotency", "kind"), idempotency.kind)
        }

        operation.requires.forEachIndexed { index, requirement ->
            if (requirement is RuleRequirement && requirement.bucket != null) {
                refusals.waiting("throttle", "A throttle rule", at.below("requires", index), Delivery.SPRING_3)
            }
        }
    }

    private fun readResponse(operation: Operation, index: Int, at: IrPlace) {
        val response = operation.responses[index]
        val responseAt = at.below("responses", index)

        // The 304 of an ETag is the cache's, refused with it above.
        if (response.derivedFrom?.derivation == ETAG_DERIVATION) return

        when (response.shape) {
            ResponseShape.ITEM, ResponseShape.TABLE, ResponseShape.LIST, ResponseShape.EMPTY -> Unit
            ResponseShape.PAGE -> refusals.waiting("response.shape", "A 'page' response", responseAt.below("shape"), Delivery.SPRING_3)
            ResponseShape.BINARY, ResponseShape.REDIRECT ->
                refusals.waiting("response.shape", "A '${response.shape.value}' response", responseAt.below("shape"), Delivery.SPRING_4)
            is ResponseShape.Unknown -> refusals.unknownValue(responseAt.below("shape"), response.shape.value)
        }

        // A derived header is the boundary's; one the route writes itself has no member in the handler result yet.
        response.headers.forEachIndexed { headerIndex, header ->
            if (header.derivedFrom == null) {
                refusals.waiting("response.header", "The response header '${header.name}', written by the route,", responseAt.below("headers", headerIndex), Delivery.AFTER_1_0)
            }
        }

        if (response.shape in PAYLOAD_SHAPES && response.media != JSON_MEDIA) {
            refusals.waiting("response.media", "A '${response.media ?: "missing"}' response body", responseAt.below("media"), Delivery.AFTER_1_0)
        }
        if (response.shape in PAYLOAD_SHAPES && response.body == null) {
            refusals.inconsistent("response.body.missing", "A '${response.shape.value}' response has no body", responseAt)
        }

        response.body?.let { readType(it, responseAt.below("body")) }
    }

    private fun readError(code: ErrorCode, at: IrPlace) {
        val declaration = ir.errors[code]
        if (declaration == null) {
            refusals.inconsistent("error.code.undeclared", "The error code '$code' is not in the errors registry", at)
            return
        }

        if (!errors.add(code)) return
        declaration.params?.let { readSchema(it, IrPlace.ROOT.below("errors", code, "params")) }
    }

    private fun readIdentity(identityId: IdentityId, at: IrPlace) {
        if (identityId in identities) return

        when (val identity = ir.identities[identityId]) {
            null -> refusals.inconsistent("identity.undeclared", "The identity '$identityId' is not declared", at)
            is SignedIdentity -> refusals.waiting("signature", "A signed identity ('$identityId')", at, Delivery.SPRING_3)
            is CredentialIdentity -> {
                identities += identityId
                val principalAt = IrPlace.ROOT.below("identities", identityId, "principal")
                when (val principal = identity.principal) {
                    is SchemaPrincipal -> readSchema(principal.schema, principalAt.below("schema"))
                    else -> refusals.waiting("principal.variants", "A principal of several variants", principalAt, Delivery.AFTER_1_0)
                }
            }
            else -> refusals.unknownValue(at, identity.kind)
        }
    }

    private fun readType(type: TypeUse, at: IrPlace) {
        when (type) {
            is RefTypeUse -> {
                if (type.unknownKeys?.policy == UnknownKeysPolicy.KEEP) {
                    refusals.waiting("unknownKeys.keep", "'unknownKeys: keep'", at.below("unknownKeys"), Delivery.AFTER_1_0)
                }
                readSchema(type.schema, at)
            }
            is ArrayTypeUse -> readType(type.items, at.below("items"))
            is EnumTypeUse -> if (ir.enums.containsKey(type.enum)) {
                enums += type.enum
            } else {
                refusals.inconsistent("enum.undeclared", "The enum '${type.enum}' is not declared", at)
            }
            is ScalarTypeUse -> readScalar(type, at)
            is FileTypeUse -> refusals.waiting("type.file", "A file value", at, Delivery.SPRING_4)
            is OpaqueTypeUse -> refusals.waiting("type.opaque", "An opaque value", at, Delivery.SPRING_3)
            is TypeUse.Unknown -> refusals.unknownValue(at.below("kind"), type.kind)
        }
    }

    private fun readScalar(type: ScalarTypeUse, at: IrPlace) {
        if (type.type is ScalarType.Unknown) refusals.unknownValue(at.below("type"), type.type.value)
        if (type.format == INT64_FORMAT) refusals.waiting("format.int64", "An 'int64' value", at.below("format"), Delivery.AFTER_1_0)
        if (type.content != null) refusals.waiting("scalar.content", "A JSON string content", at.below("content"), Delivery.AFTER_1_0)
    }

    private fun readSchema(schemaId: SchemaId, at: IrPlace) {
        if (schemaId in objects) return

        val schemaAt = IrPlace.ROOT.below("schemas", schemaId)
        when (val schema = ir.schemas[schemaId]) {
            null -> refusals.inconsistent("schema.undeclared", "The schema '$schemaId' is not declared", at)
            is ObjectSchema -> {
                objects[schemaId] = schema
                schema.properties.forEachIndexed { index, property -> readType(property.type, schemaAt.below("properties", index, "type")) }
            }
            is UnionSchema -> refusals.waiting("schema.union", "A union", schemaAt, Delivery.AFTER_1_0)
            is MapSchema -> refusals.waiting("schema.map", "A map", schemaAt, Delivery.AFTER_1_0)
            else -> refusals.unknownValue(schemaAt.below("kind"), schema.kind)
        }
    }
}
