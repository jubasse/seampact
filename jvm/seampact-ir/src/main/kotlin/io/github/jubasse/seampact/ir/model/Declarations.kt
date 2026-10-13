// Generated from packages/spec/schemas/ir/declarations.schema.json by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write
@file:OptIn(ExperimentalSerializationApi::class)

package io.github.jubasse.seampact.ir.model

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

@Serializable
public data class ApplicationSignature(
    @EncodeDefault public override val verify: String = "application",
    public val headers: List<String>,
    public val key: SchemeKey? = null,
) : SignatureVerify

/** HTTP basic credentials in the Authorization header. */
@Serializable
public data class BasicScheme(
    public val id: SchemeId,
    @EncodeDefault public override val kind: String = "basic",
    public val origin: Origin,
) : Scheme

/** Document-only facts of a bearer scheme. */
@Serializable
public data class BearerFacts(
    public val format: String? = null,
    public val oauth2: OAuth2? = null,
    public val openIdConnectUrl: String? = null,
)

/** A bearer token in the Authorization header. */
@Serializable
public data class BearerScheme(
    public val id: SchemeId,
    @EncodeDefault public override val kind: String = "bearer",
    public val bearer: BearerFacts? = null,
    public val origin: Origin,
) : Scheme

/** A rate-limit bucket (ADR 0004 section 4). */
@Serializable
public data class Bucket(
    public val id: BucketId,
    public val key: List<ValueSource>,
    public val limit: Long? = null,
    public val windowMs: Long? = null,
    public val origin: Origin,
)

@Serializable
public data class CatalogueEnumSource(
    @EncodeDefault public override val kind: String = "enum",
    public val enum: EnumId,
) : EnumSource

/** A credential in a cookie; 'csrf' names the scheme that carries the CSRF token. */
@Serializable
public data class CookieScheme(
    public val id: SchemeId,
    @EncodeDefault public override val kind: String = "cookie",
    /** The cookie name. */
    public val name: String,
    public val csrf: SchemeId? = null,
    public val origin: Origin,
) : Scheme

/** An identity reached through credential schemes. */
@Serializable
public data class CredentialIdentity(
    public val id: IdentityId,
    @EncodeDefault public override val kind: String = "credential",
    public val schemes: CredentialSchemes,
    public val principal: Principal,
    public val errors: List<ErrorCode>,
    public val headers: List<IdentityHeaderUse>,
    public val docs: Docs,
    public val extensions: Extensions,
    public val origin: Origin,
) : Identity

/** The schemes of a credential identity. */
@Serializable
public data class CredentialSchemes(
    public val read: List<SchemeId>,
    /** Empty when the identity is refused on writes. */
    public val write: List<SchemeId>,
    public val optionalRead: List<SchemeId>,
)

/** An enum; values keep the written order (ADR 0004 section 4). */
@Serializable
public data class Enum_(
    public val id: EnumId,
    public val name: Name,
    public val values: List<String>,
    /** Identifier override per value (ADR 0007). */
    public val codeNames: Map<String, Name>? = null,
    public val source: EnumSource? = null,
    public val localReason: Reason? = null,
    public val fallback: String? = null,
    public val directions: List<Direction>,
    public val docs: Docs,
    public val origin: Origin,
)

/** Where an enum's values come from: a shared vocabulary or another enum. */
@Serializable(with = EnumSourceSerializer::class)
public sealed interface EnumSource {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw with its tag. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : EnumSource
}

internal object EnumSourceSerializer : IrUnionSerializer<EnumSource>("EnumSource", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): EnumSource? = when (tag) {
        "vocabulary" -> json.decodeFromJsonElement(VocabularyEnumSource.serializer(), element)
        "enum" -> json.decodeFromJsonElement(CatalogueEnumSource.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): EnumSource = EnumSource.Unknown(tag, element)

    override fun encode(json: Json, value: EnumSource): JsonElement = when (value) {
        is VocabularyEnumSource -> json.encodeToJsonElement(VocabularyEnumSource.serializer(), value)
        is CatalogueEnumSource -> json.encodeToJsonElement(CatalogueEnumSource.serializer(), value)
        is EnumSource.Unknown -> value.raw
    }
}

/** An error code of the registry (ADR 0004 section 4). */
@Serializable
public data class ErrorDecl(
    public val code: ErrorCode,
    /** The declared family, or the code up to its first dot. */
    public val family: String? = null,
    public val nature: NatureBase,
    public val natureName: NatureId? = null,
    public val http: ErrorHttp,
    public val params: SchemaRef? = null,
    @Serializable(with = IrOptionalOpaqueSerializer::class) public val example: JsonElement? = null,
    public val title: String? = null,
    public val docs: Docs,
    public val origin: Origin,
    public val default: ErrorRole? = null,
)

/** The HTTP attributes of an error code (ADR 0014). */
@Serializable
public data class ErrorHttp(
    public val status: Long,
)

/** A role of ADR 0006 section 6. */
@Serializable(with = ErrorRoleSerializer::class)
public sealed interface ErrorRole {
    public val value: String

    public data object SCHEMA_INVALID : ErrorRole { override val value: String = "schemaInvalid" }
    public data object PAYLOAD_TOO_LARGE : ErrorRole { override val value: String = "payloadTooLarge" }
    public data object UNSUPPORTED_MEDIA_TYPE : ErrorRole { override val value: String = "unsupportedMediaType" }
    public data object UNAUTHENTICATED : ErrorRole { override val value: String = "unauthenticated" }
    public data object CSRF_INVALID : ErrorRole { override val value: String = "csrfInvalid" }
    public data object IDEMPOTENCY_KEY_REUSED : ErrorRole { override val value: String = "idempotencyKeyReused" }
    public data object IDEMPOTENCY_IN_PROGRESS : ErrorRole { override val value: String = "idempotencyInProgress" }
    public data object STATE_CONFLICT : ErrorRole { override val value: String = "stateConflict" }
    public data object PRECONDITION_FAILED : ErrorRole { override val value: String = "preconditionFailed" }
    public data object PRECONDITION_REQUIRED : ErrorRole { override val value: String = "preconditionRequired" }
    public data object NOT_FOUND : ErrorRole { override val value: String = "notFound" }
    public data object FORBIDDEN : ErrorRole { override val value: String = "forbidden" }
    public data object SORT_KEY_FORBIDDEN : ErrorRole { override val value: String = "sortKeyForbidden" }
    public data object RATE_LIMITED : ErrorRole { override val value: String = "rateLimited" }
    public data object DEADLINE_EXCEEDED : ErrorRole { override val value: String = "deadlineExceeded" }
    public data object GONE : ErrorRole { override val value: String = "gone" }
    public data object UPSTREAM_UNAVAILABLE : ErrorRole { override val value: String = "upstreamUnavailable" }
    public data object SERVICE_UNAVAILABLE : ErrorRole { override val value: String = "serviceUnavailable" }
    public data object UPSTREAM_TIMEOUT : ErrorRole { override val value: String = "upstreamTimeout" }
    public data object UNDECLARED_STATUS : ErrorRole { override val value: String = "undeclaredStatus" }

    /** A value this IR revision does not know. */
    public data class Unknown(override val value: String) : ErrorRole

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<ErrorRole> by lazy { listOf(SCHEMA_INVALID, PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE, UNAUTHENTICATED, CSRF_INVALID, IDEMPOTENCY_KEY_REUSED, IDEMPOTENCY_IN_PROGRESS, STATE_CONFLICT, PRECONDITION_FAILED, PRECONDITION_REQUIRED, NOT_FOUND, FORBIDDEN, SORT_KEY_FORBIDDEN, RATE_LIMITED, DEADLINE_EXCEEDED, GONE, UPSTREAM_UNAVAILABLE, SERVICE_UNAVAILABLE, UPSTREAM_TIMEOUT, UNDECLARED_STATUS) }

        public fun of(value: String): ErrorRole = when (value) {
            "schemaInvalid" -> SCHEMA_INVALID
            "payloadTooLarge" -> PAYLOAD_TOO_LARGE
            "unsupportedMediaType" -> UNSUPPORTED_MEDIA_TYPE
            "unauthenticated" -> UNAUTHENTICATED
            "csrfInvalid" -> CSRF_INVALID
            "idempotencyKeyReused" -> IDEMPOTENCY_KEY_REUSED
            "idempotencyInProgress" -> IDEMPOTENCY_IN_PROGRESS
            "stateConflict" -> STATE_CONFLICT
            "preconditionFailed" -> PRECONDITION_FAILED
            "preconditionRequired" -> PRECONDITION_REQUIRED
            "notFound" -> NOT_FOUND
            "forbidden" -> FORBIDDEN
            "sortKeyForbidden" -> SORT_KEY_FORBIDDEN
            "rateLimited" -> RATE_LIMITED
            "deadlineExceeded" -> DEADLINE_EXCEEDED
            "gone" -> GONE
            "upstreamUnavailable" -> UPSTREAM_UNAVAILABLE
            "serviceUnavailable" -> SERVICE_UNAVAILABLE
            "upstreamTimeout" -> UPSTREAM_TIMEOUT
            "undeclaredStatus" -> UNDECLARED_STATUS
            else -> Unknown(value)
        }
    }
}

internal object ErrorRoleSerializer : IrOpenEnumSerializer<ErrorRole>("ErrorRole", ErrorRole::of, ErrorRole::value)

/** An identity header (ADR 0002 section 9). 'name' and 'in' for every semantic but versionToken; 'response' and 'request' for versionToken (invariant ir.header.members). */
@Serializable
public data class HeaderDecl(
    public val id: HeaderId,
    public val semantic: HeaderSemantic,
    public val name: String? = null,
    @SerialName("in") public val in_: HeaderSide? = null,
    public val response: String? = null,
    public val request: String? = null,
    public val schema: TypeUse? = null,
    public val origin: Origin,
)

/** A credential in a request header. */
@Serializable
public data class HeaderScheme(
    public val id: SchemeId,
    @EncodeDefault public override val kind: String = "header",
    /** The header name. */
    public val name: String,
    public val origin: Origin,
) : Scheme

/** What an identity header carries (ADR 0002 section 9). */
@Serializable(with = HeaderSemanticSerializer::class)
public sealed interface HeaderSemantic {
    public val value: String

    public data object DEADLINE : HeaderSemantic { override val value: String = "deadline" }
    public data object TRACE_CONTEXT : HeaderSemantic { override val value: String = "traceContext" }
    public data object ACTOR_SURFACE : HeaderSemantic { override val value: String = "actorSurface" }
    public data object VERSION_TOKEN : HeaderSemantic { override val value: String = "versionToken" }

    /** A value this IR revision does not know. */
    public data class Unknown(override val value: String) : HeaderSemantic

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<HeaderSemantic> by lazy { listOf(DEADLINE, TRACE_CONTEXT, ACTOR_SURFACE, VERSION_TOKEN) }

        public fun of(value: String): HeaderSemantic = when (value) {
            "deadline" -> DEADLINE
            "traceContext" -> TRACE_CONTEXT
            "actorSurface" -> ACTOR_SURFACE
            "versionToken" -> VERSION_TOKEN
            else -> Unknown(value)
        }
    }
}

internal object HeaderSemanticSerializer : IrOpenEnumSerializer<HeaderSemantic>("HeaderSemantic", HeaderSemantic::of, HeaderSemantic::value)

/** The message a header travels in. */
@Serializable(with = HeaderSideSerializer::class)
public sealed interface HeaderSide {
    public val value: String

    public data object REQUEST : HeaderSide { override val value: String = "request" }
    public data object RESPONSE : HeaderSide { override val value: String = "response" }

    /** A value this IR revision does not know. */
    public data class Unknown(override val value: String) : HeaderSide

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<HeaderSide> by lazy { listOf(REQUEST, RESPONSE) }

        public fun of(value: String): HeaderSide = when (value) {
            "request" -> REQUEST
            "response" -> RESPONSE
            else -> Unknown(value)
        }
    }
}

internal object HeaderSideSerializer : IrOpenEnumSerializer<HeaderSide>("HeaderSide", HeaderSide::of, HeaderSide::value)

/** The operations an identity header applies to. */
@Serializable(with = HeaderUseForSerializer::class)
public sealed interface HeaderUseFor {
    public val value: String

    public data object ALL : HeaderUseFor { override val value: String = "all" }
    public data object READS : HeaderUseFor { override val value: String = "reads" }
    public data object WRITES : HeaderUseFor { override val value: String = "writes" }

    /** A value this IR revision does not know. */
    public data class Unknown(override val value: String) : HeaderUseFor

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<HeaderUseFor> by lazy { listOf(ALL, READS, WRITES) }

        public fun of(value: String): HeaderUseFor = when (value) {
            "all" -> ALL
            "reads" -> READS
            "writes" -> WRITES
            else -> Unknown(value)
        }
    }
}

internal object HeaderUseForSerializer : IrOpenEnumSerializer<HeaderUseFor>("HeaderUseFor", HeaderUseFor::of, HeaderUseFor::value)

/** An identity (ADR 0004 section 4), tagged on its kind. Must act: an unknown tag makes the IR invalid for every reader. */
@Serializable(with = IdentitySerializer::class)
public sealed interface Identity {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw with its tag. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : Identity
}

internal object IdentitySerializer : IrUnionSerializer<Identity>("Identity", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): Identity? = when (tag) {
        "credential" -> json.decodeFromJsonElement(CredentialIdentity.serializer(), element)
        "signed" -> json.decodeFromJsonElement(SignedIdentity.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): Identity = Identity.Unknown(tag, element)

    override fun encode(json: Json, value: Identity): JsonElement = when (value) {
        is CredentialIdentity -> json.encodeToJsonElement(CredentialIdentity.serializer(), value)
        is SignedIdentity -> json.encodeToJsonElement(SignedIdentity.serializer(), value)
        is Identity.Unknown -> value.raw
    }
}

/** A use of the headers catalogue by an identity. */
@Serializable
public data class IdentityHeaderUse(
    public val header: HeaderId,
    @SerialName("for") public val for_: HeaderUseFor,
    public val required: Boolean,
    public val schema: TypeUse? = null,
    public val from: ValueSource? = null,
    public val stale: ErrorCode? = null,
    public val origin: Origin,
)

@Serializable
public data class IgnoreKeysPolicy(
    @EncodeDefault public override val policy: String = "ignore",
    public val reason: Reason,
) : KeysPolicy

@Serializable
public data class KeepKeysPolicy(
    @EncodeDefault public override val policy: String = "keep",
    public val reason: Reason,
) : KeysPolicy

/** Unknown keys of a signed identity's payload: ignored or kept, with the reason. Must act: an unknown tag makes the IR invalid for every reader. */
@Serializable(with = KeysPolicySerializer::class)
public sealed interface KeysPolicy {
    /** The tag member 'policy': it picks the variant. */
    public val policy: String

    /** A variant this IR revision does not know, kept raw with its tag. */
    public data class Unknown(override val policy: String, public val raw: JsonObject) : KeysPolicy
}

internal object KeysPolicySerializer : IrUnionSerializer<KeysPolicy>("KeysPolicy", "policy") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): KeysPolicy? = when (tag) {
        "ignore" -> json.decodeFromJsonElement(IgnoreKeysPolicy.serializer(), element)
        "keep" -> json.decodeFromJsonElement(KeepKeysPolicy.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): KeysPolicy = KeysPolicy.Unknown(tag, element)

    override fun encode(json: Json, value: KeysPolicy): JsonElement = when (value) {
        is IgnoreKeysPolicy -> json.encodeToJsonElement(IgnoreKeysPolicy.serializer(), value)
        is KeepKeysPolicy -> json.encodeToJsonElement(KeepKeysPolicy.serializer(), value)
        is KeysPolicy.Unknown -> value.raw
    }
}

/** A base nature: every client's retry rule reads it. */
@Serializable(with = NatureBaseSerializer::class)
public sealed interface NatureBase {
    public val value: String

    public data object REFUSED : NatureBase { override val value: String = "refused" }
    public data object UNAVAILABLE : NatureBase { override val value: String = "unavailable" }
    public data object FAILED : NatureBase { override val value: String = "failed" }

    /** A value this IR revision does not know. */
    public data class Unknown(override val value: String) : NatureBase

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<NatureBase> by lazy { listOf(REFUSED, UNAVAILABLE, FAILED) }

        public fun of(value: String): NatureBase = when (value) {
            "refused" -> REFUSED
            "unavailable" -> UNAVAILABLE
            "failed" -> FAILED
            else -> Unknown(value)
        }
    }
}

internal object NatureBaseSerializer : IrOpenEnumSerializer<NatureBase>("NatureBase", NatureBase::of, NatureBase::value)

/** A nature of the contract (ADR 0002 section 11). */
@Serializable
public data class NatureDecl(
    public val id: NatureId,
    public val base: NatureBase,
    public val docs: Docs,
    public val origin: Origin,
)

@Serializable
public data class NoSubject(
    @EncodeDefault public override val kind: String = "none",
) : RightSubject

/** The OAuth 2 facts of a bearer scheme, for documents only. */
@Serializable
public data class OAuth2(
    /** OpenAPI OAuth flows, copied as written. */
    public val flows: JsonElement,
)

/** The principal schema: one schema, or one per credential variant. */
@Serializable(with = PrincipalSerializer::class)
public sealed interface Principal {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw with its tag. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : Principal
}

internal object PrincipalSerializer : IrUnionSerializer<Principal>("Principal", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): Principal? = when (tag) {
        "schema" -> json.decodeFromJsonElement(SchemaPrincipal.serializer(), element)
        "variants" -> json.decodeFromJsonElement(VariantsPrincipal.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): Principal = Principal.Unknown(tag, element)

    override fun encode(json: Json, value: Principal): JsonElement = when (value) {
        is SchemaPrincipal -> json.encodeToJsonElement(SchemaPrincipal.serializer(), value)
        is VariantsPrincipal -> json.encodeToJsonElement(VariantsPrincipal.serializer(), value)
        is Principal.Unknown -> value.raw
    }
}

/** Where a rule proof is read. */
@Serializable(with = ProofPlacementSerializer::class)
public sealed interface ProofPlacement {
    public val value: String

    public data object BODY : ProofPlacement { override val value: String = "body" }
    public data object HEADER : ProofPlacement { override val value: String = "header" }

    /** A value this IR revision does not know. */
    public data class Unknown(override val value: String) : ProofPlacement

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<ProofPlacement> by lazy { listOf(BODY, HEADER) }

        public fun of(value: String): ProofPlacement = when (value) {
            "body" -> BODY
            "header" -> HEADER
            else -> Unknown(value)
        }
    }
}

internal object ProofPlacementSerializer : IrOpenEnumSerializer<ProofPlacement>("ProofPlacement", ProofPlacement::of, ProofPlacement::value)

/** A credential in a query parameter. */
@Serializable
public data class QueryScheme(
    public val id: SchemeId,
    @EncodeDefault public override val kind: String = "query",
    /** The query parameter name. */
    public val name: String,
    public val origin: Origin,
) : Scheme

@Serializable
public data class ResourceSubject(
    @EncodeDefault public override val kind: String = "resource",
    public val type: Name,
    public val idSchema: TypeUse,
) : RightSubject

/** A right (ADR 0004 section 4). */
@Serializable
public data class Right(
    public val id: RightId,
    public val params: SchemaRef? = null,
    public val subject: RightSubject,
    public val guest: Reason? = null,
    public val errors: List<ErrorCode>,
    public val docs: Docs,
    public val extensions: Extensions,
    public val origin: Origin,
    public val derivedFrom: DerivedFrom? = null,
    public val codeName: Name? = null,
)

/** The subject a right is checked against. Must act: an unknown tag makes the IR invalid for every reader. */
@Serializable(with = RightSubjectSerializer::class)
public sealed interface RightSubject {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw with its tag. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : RightSubject
}

internal object RightSubjectSerializer : IrUnionSerializer<RightSubject>("RightSubject", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): RightSubject? = when (tag) {
        "none" -> json.decodeFromJsonElement(NoSubject.serializer(), element)
        "scope" -> json.decodeFromJsonElement(ScopeSubject.serializer(), element)
        "resource" -> json.decodeFromJsonElement(ResourceSubject.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): RightSubject = RightSubject.Unknown(tag, element)

    override fun encode(json: Json, value: RightSubject): JsonElement = when (value) {
        is NoSubject -> json.encodeToJsonElement(NoSubject.serializer(), value)
        is ScopeSubject -> json.encodeToJsonElement(ScopeSubject.serializer(), value)
        is ResourceSubject -> json.encodeToJsonElement(ResourceSubject.serializer(), value)
        is RightSubject.Unknown -> value.raw
    }
}

/** A rule (ADR 0004 section 4). */
@Serializable
public data class Rule(
    public val id: RuleId,
    public val params: SchemaRef? = null,
    public val takesBucket: Boolean,
    public val proof: RuleProof? = null,
    public val errors: List<ErrorCode>,
    public val docs: Docs,
    public val extensions: Extensions,
    public val origin: Origin,
)

@Serializable
public data class RuleProof(
    @SerialName("in") public val in_: ProofPlacement,
    public val name: String,
    public val schema: TypeUse,
)

@Serializable
public data class SchemaPrincipal(
    @EncodeDefault public override val kind: String = "schema",
    public val schema: SchemaRef,
) : Principal

/** A security scheme (ADR 0004 section 4), tagged on its kind. Must act: an unknown tag makes the IR invalid for every reader. */
@Serializable(with = SchemeSerializer::class)
public sealed interface Scheme {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw with its tag. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : Scheme
}

internal object SchemeSerializer : IrUnionSerializer<Scheme>("Scheme", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): Scheme? = when (tag) {
        "cookie" -> json.decodeFromJsonElement(CookieScheme.serializer(), element)
        "header" -> json.decodeFromJsonElement(HeaderScheme.serializer(), element)
        "query" -> json.decodeFromJsonElement(QueryScheme.serializer(), element)
        "bearer" -> json.decodeFromJsonElement(BearerScheme.serializer(), element)
        "basic" -> json.decodeFromJsonElement(BasicScheme.serializer(), element)
        "signature" -> json.decodeFromJsonElement(SignatureScheme.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): Scheme = Scheme.Unknown(tag, element)

    override fun encode(json: Json, value: Scheme): JsonElement = when (value) {
        is CookieScheme -> json.encodeToJsonElement(CookieScheme.serializer(), value)
        is HeaderScheme -> json.encodeToJsonElement(HeaderScheme.serializer(), value)
        is QueryScheme -> json.encodeToJsonElement(QueryScheme.serializer(), value)
        is BearerScheme -> json.encodeToJsonElement(BearerScheme.serializer(), value)
        is BasicScheme -> json.encodeToJsonElement(BasicScheme.serializer(), value)
        is SignatureScheme -> json.encodeToJsonElement(SignatureScheme.serializer(), value)
        is Scheme.Unknown -> value.raw
    }
}

/** The key a signature is verified with: an id the application resolves to its secret, never the secret itself, written as a value or read from the request. Must act: an unknown tag makes the IR invalid for every reader. */
@Serializable(with = SchemeKeySerializer::class)
public sealed interface SchemeKey {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw with its tag. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : SchemeKey
}

internal object SchemeKeySerializer : IrUnionSerializer<SchemeKey>("SchemeKey", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): SchemeKey? = when (tag) {
        "value" -> json.decodeFromJsonElement(ValueSchemeKey.serializer(), element)
        "from" -> json.decodeFromJsonElement(SourceSchemeKey.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): SchemeKey = SchemeKey.Unknown(tag, element)

    override fun encode(json: Json, value: SchemeKey): JsonElement = when (value) {
        is ValueSchemeKey -> json.encodeToJsonElement(ValueSchemeKey.serializer(), value)
        is SourceSchemeKey -> json.encodeToJsonElement(SourceSchemeKey.serializer(), value)
        is SchemeKey.Unknown -> value.raw
    }
}

/** A scope (ADR 0004 section 4). */
@Serializable
public data class Scope(
    public val id: ScopeId,
    public val idSchema: TypeUse,
    public val within: ScopeId? = null,
    public val errors: List<ErrorCode>,
    public val docs: Docs,
    public val extensions: Extensions,
    public val origin: Origin,
)

@Serializable
public data class ScopeSubject(
    @EncodeDefault public override val kind: String = "scope",
    public val scope: ScopeId,
) : RightSubject

/** An upstream service (ADR 0004 section 4). */
@Serializable
public data class Service(
    public val id: ServiceId,
    public val maturity: Maturity,
    public val origin: Origin,
)

/** How a signature is encoded. */
@Serializable(with = SignatureEncodingSerializer::class)
public sealed interface SignatureEncoding {
    public val value: String

    public data object HEX : SignatureEncoding { override val value: String = "hex" }
    public data object BASE64 : SignatureEncoding { override val value: String = "base64" }

    /** A value this IR revision does not know. */
    public data class Unknown(override val value: String) : SignatureEncoding

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<SignatureEncoding> by lazy { listOf(HEX, BASE64) }

        public fun of(value: String): SignatureEncoding = when (value) {
            "hex" -> HEX
            "base64" -> BASE64
            else -> Unknown(value)
        }
    }
}

internal object SignatureEncodingSerializer : IrOpenEnumSerializer<SignatureEncoding>("SignatureEncoding", SignatureEncoding::of, SignatureEncoding::value)

/** A signed request, verified as 'signature' says. */
@Serializable
public data class SignatureScheme(
    public val id: SchemeId,
    @EncodeDefault public override val kind: String = "signature",
    /** The signature header. */
    public val name: String? = null,
    public val signature: SignatureVerify,
    public val origin: Origin,
) : Scheme

/** How a signature is verified (ADR 0004 section 4). Must act: an unknown tag makes the IR invalid for every reader. */
@Serializable(with = SignatureVerifySerializer::class)
public sealed interface SignatureVerify {
    /** The tag member 'verify': it picks the variant. */
    public val verify: String

    /** A variant this IR revision does not know, kept raw with its tag. */
    public data class Unknown(override val verify: String, public val raw: JsonObject) : SignatureVerify
}

internal object SignatureVerifySerializer : IrUnionSerializer<SignatureVerify>("SignatureVerify", "verify") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): SignatureVerify? = when (tag) {
        "template" -> json.decodeFromJsonElement(TemplateSignature.serializer(), element)
        "application" -> json.decodeFromJsonElement(ApplicationSignature.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): SignatureVerify = SignatureVerify.Unknown(tag, element)

    override fun encode(json: Json, value: SignatureVerify): JsonElement = when (value) {
        is TemplateSignature -> json.encodeToJsonElement(TemplateSignature.serializer(), value)
        is ApplicationSignature -> json.encodeToJsonElement(ApplicationSignature.serializer(), value)
        is SignatureVerify.Unknown -> value.raw
    }
}

/** An identity reached through one signature scheme (ADR 0013). */
@Serializable
public data class SignedIdentity(
    public val id: IdentityId,
    @EncodeDefault public override val kind: String = "signed",
    public val signed: SchemeId,
    public val principal: Principal,
    public val unknownKeys: KeysPolicy? = null,
    public val errors: List<ErrorCode>,
    public val headers: List<IdentityHeaderUse>,
    public val docs: Docs,
    public val extensions: Extensions,
    public val origin: Origin,
) : Identity

@Serializable
public data class SourceSchemeKey(
    @EncodeDefault public override val kind: String = "from",
    /** Where the request carries the key id (path, query or header). */
    public val from: ValueSource,
) : SchemeKey

@Serializable
public data class TemplateSignature(
    @EncodeDefault public override val verify: String = "template",
    public val format: String,
    public val algorithm: String,
    public val payload: String,
    public val encoding: SignatureEncoding,
    public val toleranceMs: Long? = null,
    public val key: SchemeKey,
) : SignatureVerify

@Serializable
public data class ValueSchemeKey(
    @EncodeDefault public override val kind: String = "value",
    /** The key id the application looks its secret up by; never the secret. */
    public val value: String,
) : SchemeKey

@Serializable
public data class VariantsPrincipal(
    @EncodeDefault public override val kind: String = "variants",
    public val variants: Map<VariantId, SchemaRef>,
) : Principal

@Serializable
public data class VocabularyEnumSource(
    @EncodeDefault public override val kind: String = "vocabulary",
    public val vocabulary: String,
) : EnumSource
