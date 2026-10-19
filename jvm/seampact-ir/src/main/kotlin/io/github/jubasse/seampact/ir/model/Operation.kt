// Generated from packages/core/spec/schemas/ir/operation.schema.json by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write
@file:OptIn(ExperimentalSerializationApi::class)
@file:UseSerializers(IrIntegerSerializer::class)

package io.github.jubasse.seampact.ir.model

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Required
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Who may call the operation. Must act: an unknown tag makes the IR invalid for every reader. */
@Serializable(with = AccessSerializer::class)
public sealed interface Access {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : Access {
        init {
            require(kind !in setOf("identity", "optional", "public")) { "Access.Unknown: \"" + kind + "\" is a known kind" }
            require(raw["kind"] == JsonPrimitive(kind)) { "Access.Unknown: raw's kind is not \"" + kind + "\"" }
        }
    }
}

internal object AccessSerializer : IrUnionSerializer<Access>("Access", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): Access? = when (tag) {
        "identity" -> json.decodeFromJsonElement(IdentityAccess.serializer(), element)
        "optional" -> json.decodeFromJsonElement(OptionalAccess.serializer(), element)
        "public" -> json.decodeFromJsonElement(PublicAccess.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): Access = Access.Unknown(tag, element)

    override fun encode(json: Json, value: Access): JsonElement = when (value) {
        is IdentityAccess -> json.encodeToJsonElement(IdentityAccess.serializer(), value)
        is OptionalAccess -> json.encodeToJsonElement(OptionalAccess.serializer(), value)
        is PublicAccess -> json.encodeToJsonElement(PublicAccess.serializer(), value)
        is Access.Unknown -> value.raw
    }
}

@Serializable
public data class Binding(
    public val from: ValueSource,
    public val to: ValueSource,
    public val origin: Origin,
)

/** Cache settings (ADR 0004 section 7). */
@Serializable
public data class Cache(
    public val family: String,
    /** Absent if and only if the family is 'never' (invariant ir.cache.directives). */
    public val directives: CacheDirectives? = null,
    public val anonymous: CacheVisibility,
    public val vary: List<String>,
    public val etag: Boolean,
    public val perCallerKind: List<CallerCacheControl>,
    /** Authoritative: when true the response is never stored, whatever 'directives' hold. True when the family is 'never' or a response carries a sensitive field (ADR 0003 section 6, invariant ir.cache.sensitive-no-store). */
    public val noStore: Boolean,
    public val origin: Origin,
    public val derivedFrom: DerivedFrom? = null,
)

@Serializable
public data class CacheDirectives(
    public val maxAgeMs: Long,
    public val sharedMaxAgeMs: Long? = null,
    public val staleWhileRevalidateMs: Long? = null,
    public val staleIfErrorMs: Long? = null,
    public val immutable: Boolean,
    public val noCache: Boolean,
    public val mustRevalidate: Boolean,
)

/** Whether a shared cache may store an anonymous response. */
@Serializable(with = CacheVisibilitySerializer::class)
public sealed interface CacheVisibility {
    public val value: String

    public data object PUBLIC : CacheVisibility { override val value: String = "public" }
    public data object PRIVATE : CacheVisibility { override val value: String = "private" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : CacheVisibility {
        init {
            require(CacheVisibility.known.none { it.value == value }) { "CacheVisibility.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<CacheVisibility> by lazy { listOf(PUBLIC, PRIVATE) }

        public fun of(value: String): CacheVisibility = when (value) {
            "public" -> PUBLIC
            "private" -> PRIVATE
            else -> Unknown(value)
        }
    }
}

internal object CacheVisibilitySerializer : IrOpenEnumSerializer<CacheVisibility>("CacheVisibility", CacheVisibility::of, CacheVisibility::value)

@Serializable
public data class CallerCacheControl(
    public val caller: CallerKind,
    public val cacheControl: String,
)

@Serializable(with = CallerKindSerializer::class)
public sealed interface CallerKind {
    public val value: String

    public data object ANONYMOUS : CallerKind { override val value: String = "anonymous" }
    public data object IDENTIFIED : CallerKind { override val value: String = "identified" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : CallerKind {
        init {
            require(CallerKind.known.none { it.value == value }) { "CallerKind.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<CallerKind> by lazy { listOf(ANONYMOUS, IDENTIFIED) }

        public fun of(value: String): CallerKind = when (value) {
            "anonymous" -> ANONYMOUS
            "identified" -> IDENTIFIED
            else -> Unknown(value)
        }
    }
}

internal object CallerKindSerializer : IrOpenEnumSerializer<CallerKind>("CallerKind", CallerKind::of, CallerKind::value)

@Serializable
public data class Concurrency(
    public val version: ValueSource,
    public val field: String,
    public val derivedFrom: DerivedFrom,
)

/** The CSRF check of an unsafe operation reached through a cookie scheme: the derived header, or an exemption with its reason (invariant ir.csrf.cookie). Must act: an unknown tag makes the IR invalid for every reader. */
@Serializable(with = CsrfSerializer::class)
public sealed interface Csrf {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : Csrf {
        init {
            require(kind !in setOf("derived", "exempt")) { "Csrf.Unknown: \"" + kind + "\" is a known kind" }
            require(raw["kind"] == JsonPrimitive(kind)) { "Csrf.Unknown: raw's kind is not \"" + kind + "\"" }
        }
    }
}

internal object CsrfSerializer : IrUnionSerializer<Csrf>("Csrf", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): Csrf? = when (tag) {
        "derived" -> json.decodeFromJsonElement(DerivedCsrf.serializer(), element)
        "exempt" -> json.decodeFromJsonElement(ExemptCsrf.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): Csrf = Csrf.Unknown(tag, element)

    override fun encode(json: Json, value: Csrf): JsonElement = when (value) {
        is DerivedCsrf -> json.encodeToJsonElement(DerivedCsrf.serializer(), value)
        is ExemptCsrf -> json.encodeToJsonElement(ExemptCsrf.serializer(), value)
        is Csrf.Unknown -> value.raw
    }
}

@Serializable
public data class Degradable(
    public val paths: List<String>,
    /** The header listing degraded parts, an RFC 9110 token; required when the operation's format has no 'degraded' meta member (invariant ir.degradable.header). */
    public val header: String? = null,
    public val origin: Origin,
)

@Serializable
public data class Deprecation(
    /** The day the operation is deprecated, a calendar date, the Deprecation header's date (RFC 9745). */
    public val since: String,
    public val sunset: String,
    public val successor: OperationRef? = null,
    /** The Link rel of the successor, an RFC 8288 registered relation name; present if and only if 'successor' is (invariant ir.deprecation.headers). */
    public val successorRel: String? = null,
    public val origin: Origin,
)

@Serializable
public data class DerivedCsrf(
    @Required @EncodeDefault public override val kind: String = "derived",
    public val header: String,
    public val derivedFrom: DerivedFrom,
) : Csrf {
    init {
        require(kind == "derived") { "DerivedCsrf: kind is \"derived\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class DerivedIdempotency(
    @Required @EncodeDefault public override val kind: String = "derived",
    public val header: String,
    public val replayHeader: String,
    public val lifetimeMs: Long,
    public val required: Boolean,
    public val enforce: IdempotencyEnforcement,
    public val derivedFrom: DerivedFrom,
) : Idempotency {
    init {
        require(kind == "derived") { "DerivedIdempotency: kind is \"derived\", got \"" + kind + "\"" }
    }
}

/** A role this code answers on the operation and the template filling its params from the role's data (ADR 0006 section 6). */
@Serializable
public data class ErrorRoleBinding(
    public val role: ErrorRole,
    /** Present if and only if the code declares params (invariant ir.error.role-params). */
    public val params: Template? = null,
)

@Serializable
public data class ExemptCsrf(
    @Required @EncodeDefault public override val kind: String = "exempt",
    public val reason: Reason,
    public val origin: Origin,
) : Csrf {
    init {
        require(kind == "exempt") { "ExemptCsrf: kind is \"exempt\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class ExemptIdempotency(
    @Required @EncodeDefault public override val kind: String = "exempt",
    public val reason: Reason,
    public val origin: Origin,
) : Idempotency {
    init {
        require(kind == "exempt") { "ExemptIdempotency: kind is \"exempt\", got \"" + kind + "\"" }
    }
}

/** A field right, materialised so targets never walk schemas (FR-23). */
@Serializable
public data class FieldRight(
    public val schema: SchemaId,
    public val pointer: String,
    public val right: RightId,
    @Serializable(with = IrOptionalOpaqueSerializer::class) public val params: JsonElement? = null,
    public val subject: FieldRightSubject? = null,
    public val direction: Direction,
    public val inputPolicy: InputPolicy? = null,
    public val always: FieldRightAlways? = null,
    public val derivedFrom: DerivedFrom,
)

/** An outcome that needs no decide call: 'absent', the field is never sent on this operation (ADR 0003 section 6). Must act: an unknown value makes the IR invalid for every reader. */
@Serializable(with = FieldRightAlwaysSerializer::class)
public sealed interface FieldRightAlways {
    public val value: String

    public data object ABSENT : FieldRightAlways { override val value: String = "absent" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : FieldRightAlways {
        init {
            require(FieldRightAlways.known.none { it.value == value }) { "FieldRightAlways.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<FieldRightAlways> by lazy { listOf(ABSENT) }

        public fun of(value: String): FieldRightAlways = when (value) {
            "absent" -> ABSENT
            else -> Unknown(value)
        }
    }
}

internal object FieldRightAlwaysSerializer : IrOpenEnumSerializer<FieldRightAlways>("FieldRightAlways", FieldRightAlways::of, FieldRightAlways::value)

@Serializable
public data class FieldRightSubject(
    /** Where the subject is read; 'in: holderField' names the holder's property on output. */
    public val source: ValueSource,
)

/** The wire form of a form or multipart field: a query wire kind with style, explode and brackets, or kind 'file' or 'json' alone (invariant ir.field-wire.members). */
@Serializable
public data class FieldWire(
    public val kind: FieldWireKind,
    public val style: QueryStyle? = null,
    public val explode: Boolean? = null,
    public val brackets: Boolean? = null,
)

/** How a form or multipart field is written: a query wire kind, 'file' or 'json'. */
@Serializable(with = FieldWireKindSerializer::class)
public sealed interface FieldWireKind {
    public val value: String

    public data object NUMBER : FieldWireKind { override val value: String = "number" }
    public data object BOOLEAN : FieldWireKind { override val value: String = "boolean" }
    public data object LIST : FieldWireKind { override val value: String = "list" }
    public data object TEXT : FieldWireKind { override val value: String = "text" }
    public data object OBJECT : FieldWireKind { override val value: String = "object" }
    public data object FILE : FieldWireKind { override val value: String = "file" }
    public data object JSON : FieldWireKind { override val value: String = "json" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : FieldWireKind {
        init {
            require(FieldWireKind.known.none { it.value == value }) { "FieldWireKind.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<FieldWireKind> by lazy { listOf(NUMBER, BOOLEAN, LIST, TEXT, OBJECT, FILE, JSON) }

        public fun of(value: String): FieldWireKind = when (value) {
            "number" -> NUMBER
            "boolean" -> BOOLEAN
            "list" -> LIST
            "text" -> TEXT
            "object" -> OBJECT
            "file" -> FILE
            "json" -> JSON
            else -> Unknown(value)
        }
    }
}

internal object FieldWireKindSerializer : IrOpenEnumSerializer<FieldWireKind>("FieldWireKind", FieldWireKind::of, FieldWireKind::value)

@Serializable(with = HttpMethodSerializer::class)
public sealed interface HttpMethod {
    public val value: String

    public data object GET : HttpMethod { override val value: String = "get" }
    public data object POST : HttpMethod { override val value: String = "post" }
    public data object PUT : HttpMethod { override val value: String = "put" }
    public data object PATCH : HttpMethod { override val value: String = "patch" }
    public data object DELETE : HttpMethod { override val value: String = "delete" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : HttpMethod {
        init {
            require(HttpMethod.known.none { it.value == value }) { "HttpMethod.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<HttpMethod> by lazy { listOf(GET, POST, PUT, PATCH, DELETE) }

        public fun of(value: String): HttpMethod = when (value) {
            "get" -> GET
            "post" -> POST
            "put" -> PUT
            "patch" -> PATCH
            "delete" -> DELETE
            else -> Unknown(value)
        }
    }
}

internal object HttpMethodSerializer : IrOpenEnumSerializer<HttpMethod>("HttpMethod", HttpMethod::of, HttpMethod::value)

/** The idempotency key of an unsafe operation: derived settings, or an exemption with its reason. Must act: an unknown tag makes the IR invalid for every reader. */
@Serializable(with = IdempotencySerializer::class)
public sealed interface Idempotency {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : Idempotency {
        init {
            require(kind !in setOf("derived", "exempt")) { "Idempotency.Unknown: \"" + kind + "\" is a known kind" }
            require(raw["kind"] == JsonPrimitive(kind)) { "Idempotency.Unknown: raw's kind is not \"" + kind + "\"" }
        }
    }
}

internal object IdempotencySerializer : IrUnionSerializer<Idempotency>("Idempotency", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): Idempotency? = when (tag) {
        "derived" -> json.decodeFromJsonElement(DerivedIdempotency.serializer(), element)
        "exempt" -> json.decodeFromJsonElement(ExemptIdempotency.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): Idempotency = Idempotency.Unknown(tag, element)

    override fun encode(json: Json, value: Idempotency): JsonElement = when (value) {
        is DerivedIdempotency -> json.encodeToJsonElement(DerivedIdempotency.serializer(), value)
        is ExemptIdempotency -> json.encodeToJsonElement(ExemptIdempotency.serializer(), value)
        is Idempotency.Unknown -> value.raw
    }
}

/** Where the idempotency key is enforced. */
@Serializable(with = IdempotencyEnforcementSerializer::class)
public sealed interface IdempotencyEnforcement {
    public val value: String

    public data object BOUNDARY : IdempotencyEnforcement { override val value: String = "boundary" }
    public data object NONE : IdempotencyEnforcement { override val value: String = "none" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : IdempotencyEnforcement {
        init {
            require(IdempotencyEnforcement.known.none { it.value == value }) { "IdempotencyEnforcement.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<IdempotencyEnforcement> by lazy { listOf(BOUNDARY, NONE) }

        public fun of(value: String): IdempotencyEnforcement = when (value) {
            "boundary" -> BOUNDARY
            "none" -> NONE
            else -> Unknown(value)
        }
    }
}

internal object IdempotencyEnforcementSerializer : IrOpenEnumSerializer<IdempotencyEnforcement>("IdempotencyEnforcement", IdempotencyEnforcement::of, IdempotencyEnforcement::value)

@Serializable
public data class IdentityAccess(
    @Required @EncodeDefault public override val kind: String = "identity",
    public val identity: IdentityId,
    public val schemes: List<SchemeId>,
    public val origin: Origin,
) : Access {
    init {
        require(kind == "identity") { "IdentityAccess: kind is \"identity\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class IgnoreUnknownQuery(
    @Required @EncodeDefault public override val policy: String = "ignore",
    public val reason: Reason,
    public val origin: Origin,
) : UnknownQuery {
    init {
        require(policy == "ignore") { "IgnoreUnknownQuery: policy is \"ignore\", got \"" + policy + "\"" }
    }
}

@Serializable
public data class InputField(
    public val name: String,
    public val wire: FieldWire,
)

/** The media type of a request body. */
@Serializable(with = InputMediaTypeSerializer::class)
public sealed interface InputMediaType {
    public val value: String

    public data object APPLICATION_JSON : InputMediaType { override val value: String = "application/json" }
    public data object APPLICATION_X_WWW_FORM_URLENCODED : InputMediaType { override val value: String = "application/x-www-form-urlencoded" }
    public data object MULTIPART_FORM_DATA : InputMediaType { override val value: String = "multipart/form-data" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : InputMediaType {
        init {
            require(InputMediaType.known.none { it.value == value }) { "InputMediaType.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<InputMediaType> by lazy { listOf(APPLICATION_JSON, APPLICATION_X_WWW_FORM_URLENCODED, MULTIPART_FORM_DATA) }

        public fun of(value: String): InputMediaType = when (value) {
            "application/json" -> APPLICATION_JSON
            "application/x-www-form-urlencoded" -> APPLICATION_X_WWW_FORM_URLENCODED
            "multipart/form-data" -> MULTIPART_FORM_DATA
            else -> Unknown(value)
        }
    }
}

internal object InputMediaTypeSerializer : IrOpenEnumSerializer<InputMediaType>("InputMediaType", InputMediaType::of, InputMediaType::value)

/** A body field the compiler adds to the input for a rule proof read in the body (derivation 'rule.proof'): required and sensitive (ADR 0002 section 9). A proof read in a header is a derived header parameter. */
@Serializable
public data class InputProof(
    public val name: String,
    public val schema: TypeUse,
    /** The proof's wire form, as an input field's: present exactly when the input's media is form or multipart, and never of kind 'file' (invariant ir.input-proof.wire). */
    public val wire: FieldWire? = null,
    public val derivedFrom: DerivedFrom,
)

/** Where an operation's maturity comes from. */
@Serializable(with = MaturitySourceSerializer::class)
public sealed interface MaturitySource {
    public val value: String

    public data object API : MaturitySource { override val value: String = "api" }
    public data object UPSTREAM : MaturitySource { override val value: String = "upstream" }
    public data object STATED : MaturitySource { override val value: String = "stated" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : MaturitySource {
        init {
            require(MaturitySource.known.none { it.value == value }) { "MaturitySource.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<MaturitySource> by lazy { listOf(API, UPSTREAM, STATED) }

        public fun of(value: String): MaturitySource = when (value) {
            "api" -> API
            "upstream" -> UPSTREAM
            "stated" -> STATED
            else -> Unknown(value)
        }
    }
}

internal object MaturitySourceSerializer : IrOpenEnumSerializer<MaturitySource>("MaturitySource", MaturitySource::of, MaturitySource::value)

/** The ops shorthand an operation came from. */
@Serializable(with = OpShorthandSerializer::class)
public sealed interface OpShorthand {
    public val value: String

    public data object LIST : OpShorthand { override val value: String = "list" }
    public data object GET : OpShorthand { override val value: String = "get" }
    public data object CREATE : OpShorthand { override val value: String = "create" }
    public data object UPDATE : OpShorthand { override val value: String = "update" }
    public data object DELETE : OpShorthand { override val value: String = "delete" }
    public data object BATCH : OpShorthand { override val value: String = "batch" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : OpShorthand {
        init {
            require(OpShorthand.known.none { it.value == value }) { "OpShorthand.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<OpShorthand> by lazy { listOf(LIST, GET, CREATE, UPDATE, DELETE, BATCH) }

        public fun of(value: String): OpShorthand = when (value) {
            "list" -> LIST
            "get" -> GET
            "create" -> CREATE
            "update" -> UPDATE
            "delete" -> DELETE
            "batch" -> BATCH
            else -> Unknown(value)
        }
    }
}

internal object OpShorthandSerializer : IrOpenEnumSerializer<OpShorthand>("OpShorthand", OpShorthand::of, OpShorthand::value)

/** An HTTP operation (ADR 0004 section 7). */
@Serializable
public data class Operation(
    public val kind: DeclarationKind,
    public val id: OperationId,
    public val name: Name,
    public val surface: SurfaceId,
    public val op: OpShorthand? = null,
    public val resource: OperationResource? = null,
    public val features: List<Feature>,
    public val method: HttpMethod,
    public val path: String,
    public val safe: Boolean,
    public val params: Params,
    public val unknownQuery: UnknownQuery,
    public val access: Access,
    public val callerKinds: List<CallerKind>,
    public val principalRequires: List<PrincipalRequirement>,
    public val scopes: List<OperationScope>,
    public val requires: List<Requirement>,
    public val bindings: List<Binding>,
    public val input: OperationInput? = null,
    public val responses: List<Response>,
    public val errors: List<OperationError>,
    public val fieldRights: List<FieldRight>,
    public val idempotency: Idempotency? = null,
    public val concurrency: Concurrency? = null,
    public val owner: Owner? = null,
    public val cache: Cache? = null,
    public val paging: Paging? = null,
    public val filteredBy: RightId? = null,
    public val degradable: Degradable? = null,
    public val budgetMs: Long? = null,
    public val deadlineHeader: String? = null,
    public val deprecated: Deprecation? = null,
    public val relays: OperationRef? = null,
    public val upstream: List<ServiceId>,
    public val maturity: OperationMaturity,
    public val internal: Boolean,
    public val csrf: Csrf? = null,
    public val format: FormatId,
    public val tags: List<String>,
    public val examples: Map<String, OperationExample>,
    public val docs: Docs,
    public val extensions: Extensions,
    public val origin: Origin,
)

/** A code the operation can answer, declared or derived. */
@Serializable
public data class OperationError(
    public val code: ErrorCode,
    @Serializable(with = IrOptionalOpaqueSerializer::class) public val example: JsonElement? = null,
    /** Sorted by role; absent when the code answers no role here. */
    public val roles: List<ErrorRoleBinding>? = null,
    public val retryHeader: RetryHeader? = null,
    public val derivedFrom: DerivedFrom? = null,
    public val origin: Origin? = null,
)

/** A route example; with 'error', 'value' holds the code's params. */
@Serializable
public data class OperationExample(
    public val status: Long? = null,
    public val request: Boolean? = null,
    public val error: ErrorCode? = null,
    public val value: JsonElement,
)

/** The request body. */
@Serializable
public data class OperationInput(
    public val media: InputMediaType,
    public val schema: TypeUse,
    public val bodyLimitBytes: Long,
    public val rawBody: Boolean,
    public val fields: List<InputField>? = null,
    /** The body fields of the rule proofs read in the body, each once, in requirement order; absent when there is none. Targets render the body as the input schema's properties followed by these fields. */
    public val proofs: List<InputProof>? = null,
    public val origin: Origin,
)

@Serializable
public data class OperationMaturity(
    public val level: Maturity,
    public val source: MaturitySource,
    public val reason: Reason? = null,
    public val origin: Origin,
)

/** A kind-tagged operation reference (ADR 0014). */
@Serializable
public data class OperationRef(
    public val kind: DeclarationKind,
    public val api: String,
    public val id: OperationId,
)

/** The collection or single it belongs to. */
@Serializable
public data class OperationResource(
    public val type: String,
    public val idParam: String? = null,
    public val idProperty: String? = null,
)

@Serializable
public data class OperationScope(
    public val scope: ScopeId,
    /** Where the scope id is read; 'in: resolver' for an application resolver. */
    public val source: ValueSource,
    public val origin: Origin,
)

@Serializable
public data class OptionalAccess(
    @Required @EncodeDefault public override val kind: String = "optional",
    public val identity: IdentityId,
    public val schemes: List<SchemeId>,
    public val reason: Reason,
    public val onRefused: RefusedCredential,
    public val origin: Origin,
) : Access {
    init {
        require(kind == "optional") { "OptionalAccess: kind is \"optional\", got \"" + kind + "\"" }
    }
}

/** What a limit above maxLimit does. */
@Serializable(with = OverLimitPolicySerializer::class)
public sealed interface OverLimitPolicy {
    public val value: String

    public data object REJECT : OverLimitPolicy { override val value: String = "reject" }
    public data object CLAMP : OverLimitPolicy { override val value: String = "clamp" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : OverLimitPolicy {
        init {
            require(OverLimitPolicy.known.none { it.value == value }) { "OverLimitPolicy.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<OverLimitPolicy> by lazy { listOf(REJECT, CLAMP) }

        public fun of(value: String): OverLimitPolicy = when (value) {
            "reject" -> REJECT
            "clamp" -> CLAMP
            else -> Unknown(value)
        }
    }
}

internal object OverLimitPolicySerializer : IrOpenEnumSerializer<OverLimitPolicy>("OverLimitPolicy", OverLimitPolicy::of, OverLimitPolicy::value)

@Serializable
public data class Owner(
    public val kind: OwnerKind,
    public val origin: Origin,
)

/** Who owns the resource an operation writes. */
@Serializable(with = OwnerKindSerializer::class)
public sealed interface OwnerKind {
    public val value: String

    public data object CALLER : OwnerKind { override val value: String = "caller" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : OwnerKind {
        init {
            require(OwnerKind.known.none { it.value == value }) { "OwnerKind.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<OwnerKind> by lazy { listOf(CALLER) }

        public fun of(value: String): OwnerKind = when (value) {
            "caller" -> CALLER
            else -> Unknown(value)
        }
    }
}

internal object OwnerKindSerializer : IrOpenEnumSerializer<OwnerKind>("OwnerKind", OwnerKind::of, OwnerKind::value)

/** The paging of a list; 'style' is absent for an unpaged list. */
@Serializable
public data class Paging(
    public val style: PagingId? = null,
    public val maxLimit: Long? = null,
    public val defaultLimit: Long? = null,
    public val overLimit: OverLimitPolicy,
    public val token: PagingToken? = null,
    public val sortKeys: List<SortKey>,
    public val origin: Origin,
)

/** What a paging token holds. */
@Serializable(with = PagingTokenSerializer::class)
public sealed interface PagingToken {
    public val value: String

    public data object OPAQUE : PagingToken { override val value: String = "opaque" }
    public data object INSTANT : PagingToken { override val value: String = "instant" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : PagingToken {
        init {
            require(PagingToken.known.none { it.value == value }) { "PagingToken.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<PagingToken> by lazy { listOf(OPAQUE, INSTANT) }

        public fun of(value: String): PagingToken = when (value) {
            "opaque" -> OPAQUE
            "instant" -> INSTANT
            else -> Unknown(value)
        }
    }
}

internal object PagingTokenSerializer : IrOpenEnumSerializer<PagingToken>("PagingToken", PagingToken::of, PagingToken::value)

/** A path, query or header parameter, declared (origin) or derived (derivedFrom). */
@Serializable
public data class Param(
    public val name: String,
    public val type: TypeUse,
    public val required: Boolean,
    public val wire: QueryWire? = null,
    @Serializable(with = IrOptionalOpaqueSerializer::class) public val default: JsonElement? = null,
    public val origin: Origin? = null,
    public val derivedFrom: DerivedFrom? = null,
)

@Serializable
public data class Params(
    public val path: List<Param>,
    public val query: List<Param>,
    public val header: List<Param>,
)

@Serializable
public data class PrincipalRequirement(
    public val field: String,
    public val origin: Origin,
)

@Serializable
public data class PublicAccess(
    @Required @EncodeDefault public override val kind: String = "public",
    public val reason: Reason,
    public val origin: Origin,
) : Access {
    init {
        require(kind == "public") { "PublicAccess: kind is \"public\", got \"" + kind + "\"" }
    }
}

/** The OpenAPI style of a query value. */
@Serializable(with = QueryStyleSerializer::class)
public sealed interface QueryStyle {
    public val value: String

    public data object FORM : QueryStyle { override val value: String = "form" }
    public data object DEEP_OBJECT : QueryStyle { override val value: String = "deepObject" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : QueryStyle {
        init {
            require(QueryStyle.known.none { it.value == value }) { "QueryStyle.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<QueryStyle> by lazy { listOf(FORM, DEEP_OBJECT) }

        public fun of(value: String): QueryStyle = when (value) {
            "form" -> FORM
            "deepObject" -> DEEP_OBJECT
            else -> Unknown(value)
        }
    }
}

internal object QueryStyleSerializer : IrOpenEnumSerializer<QueryStyle>("QueryStyle", QueryStyle::of, QueryStyle::value)

/** The wire form of a query parameter (FR-30). */
@Serializable
public data class QueryWire(
    public val kind: QueryWireKind,
    public val style: QueryStyle,
    public val explode: Boolean,
    /** A list sent as 'name[]'. */
    public val brackets: Boolean,
)

/** How a query value is written (FR-30). */
@Serializable(with = QueryWireKindSerializer::class)
public sealed interface QueryWireKind {
    public val value: String

    public data object NUMBER : QueryWireKind { override val value: String = "number" }
    public data object BOOLEAN : QueryWireKind { override val value: String = "boolean" }
    public data object LIST : QueryWireKind { override val value: String = "list" }
    public data object TEXT : QueryWireKind { override val value: String = "text" }
    public data object OBJECT : QueryWireKind { override val value: String = "object" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : QueryWireKind {
        init {
            require(QueryWireKind.known.none { it.value == value }) { "QueryWireKind.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<QueryWireKind> by lazy { listOf(NUMBER, BOOLEAN, LIST, TEXT, OBJECT) }

        public fun of(value: String): QueryWireKind = when (value) {
            "number" -> NUMBER
            "boolean" -> BOOLEAN
            "list" -> LIST
            "text" -> TEXT
            "object" -> OBJECT
            else -> Unknown(value)
        }
    }
}

internal object QueryWireKindSerializer : IrOpenEnumSerializer<QueryWireKind>("QueryWireKind", QueryWireKind::of, QueryWireKind::value)

@Serializable
public data class RefuseUnknownQuery(
    @Required @EncodeDefault public override val policy: String = "refuse",
) : UnknownQuery {
    init {
        require(policy == "refuse") { "RefuseUnknownQuery: policy is \"refuse\", got \"" + policy + "\"" }
    }
}

/** What an optional-auth operation does with a refused credential: serve it as anonymous, or answer 401. Must act: an unknown value makes the IR invalid for every reader. */
@Serializable(with = RefusedCredentialSerializer::class)
public sealed interface RefusedCredential {
    public val value: String

    public data object ANONYMOUS : RefusedCredential { override val value: String = "anonymous" }
    public data object REJECT : RefusedCredential { override val value: String = "reject" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : RefusedCredential {
        init {
            require(RefusedCredential.known.none { it.value == value }) { "RefusedCredential.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<RefusedCredential> by lazy { listOf(ANONYMOUS, REJECT) }

        public fun of(value: String): RefusedCredential = when (value) {
            "anonymous" -> ANONYMOUS
            "reject" -> REJECT
            else -> Unknown(value)
        }
    }
}

internal object RefusedCredentialSerializer : IrOpenEnumSerializer<RefusedCredential>("RefusedCredential", RefusedCredential::of, RefusedCredential::value)

/** A requirement, in declared order (FR-5). Must act: an unknown tag makes the IR invalid for every reader. */
@Serializable(with = RequirementSerializer::class)
public sealed interface Requirement {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : Requirement {
        init {
            require(kind !in setOf("right", "rule")) { "Requirement.Unknown: \"" + kind + "\" is a known kind" }
            require(raw["kind"] == JsonPrimitive(kind)) { "Requirement.Unknown: raw's kind is not \"" + kind + "\"" }
        }
    }
}

internal object RequirementSerializer : IrUnionSerializer<Requirement>("Requirement", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): Requirement? = when (tag) {
        "right" -> json.decodeFromJsonElement(RightRequirement.serializer(), element)
        "rule" -> json.decodeFromJsonElement(RuleRequirement.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): Requirement = Requirement.Unknown(tag, element)

    override fun encode(json: Json, value: Requirement): JsonElement = when (value) {
        is RightRequirement -> json.encodeToJsonElement(RightRequirement.serializer(), value)
        is RuleRequirement -> json.encodeToJsonElement(RuleRequirement.serializer(), value)
        is Requirement.Unknown -> value.raw
    }
}

@Serializable
public data class RequirementSubject(
    public val source: ValueSource,
    public val defaulted: Boolean,
)

/** A success or derived non-error response. */
@Serializable
public data class Response(
    public val status: Long,
    /** Absent for an empty body. */
    public val media: String? = null,
    public val body: TypeUse? = null,
    public val shape: ResponseShape,
    public val headers: List<ResponseHeader>,
    public val origin: Origin? = null,
    public val derivedFrom: DerivedFrom? = null,
    /** The docs written on the response. */
    public val docs: Docs? = null,
)

@Serializable
public data class ResponseHeader(
    public val name: String,
    public val type: TypeUse,
    public val required: Boolean,
    public val semantic: ResponseHeaderSemantic? = null,
    public val origin: Origin? = null,
    public val derivedFrom: DerivedFrom? = null,
)

/** What a response header carries: an identity header's semantic (declarations HeaderSemantic) or a deprecation header (ADR 0004 section 7). */
@Serializable(with = ResponseHeaderSemanticSerializer::class)
public sealed interface ResponseHeaderSemantic {
    public val value: String

    public data object DEADLINE : ResponseHeaderSemantic { override val value: String = "deadline" }
    public data object TRACE_CONTEXT : ResponseHeaderSemantic { override val value: String = "traceContext" }
    public data object ACTOR_SURFACE : ResponseHeaderSemantic { override val value: String = "actorSurface" }
    public data object VERSION_TOKEN : ResponseHeaderSemantic { override val value: String = "versionToken" }
    public data object DEPRECATION : ResponseHeaderSemantic { override val value: String = "deprecation" }
    public data object SUNSET : ResponseHeaderSemantic { override val value: String = "sunset" }
    public data object SUCCESSOR_LINK : ResponseHeaderSemantic { override val value: String = "successorLink" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : ResponseHeaderSemantic {
        init {
            require(ResponseHeaderSemantic.known.none { it.value == value }) { "ResponseHeaderSemantic.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<ResponseHeaderSemantic> by lazy { listOf(DEADLINE, TRACE_CONTEXT, ACTOR_SURFACE, VERSION_TOKEN, DEPRECATION, SUNSET, SUCCESSOR_LINK) }

        public fun of(value: String): ResponseHeaderSemantic = when (value) {
            "deadline" -> DEADLINE
            "traceContext" -> TRACE_CONTEXT
            "actorSurface" -> ACTOR_SURFACE
            "versionToken" -> VERSION_TOKEN
            "deprecation" -> DEPRECATION
            "sunset" -> SUNSET
            "successorLink" -> SUCCESSOR_LINK
            else -> Unknown(value)
        }
    }
}

internal object ResponseHeaderSemanticSerializer : IrOpenEnumSerializer<ResponseHeaderSemantic>("ResponseHeaderSemantic", ResponseHeaderSemantic::of, ResponseHeaderSemantic::value)

/** The format shape of a response; 'binary' and 'redirect' bypass the format (ADR 0004 section 8). */
@Serializable(with = ResponseShapeSerializer::class)
public sealed interface ResponseShape {
    public val value: String

    public data object ITEM : ResponseShape { override val value: String = "item" }
    public data object TABLE : ResponseShape { override val value: String = "table" }
    public data object LIST : ResponseShape { override val value: String = "list" }
    public data object PAGE : ResponseShape { override val value: String = "page" }
    public data object EMPTY : ResponseShape { override val value: String = "empty" }
    public data object BINARY : ResponseShape { override val value: String = "binary" }
    public data object REDIRECT : ResponseShape { override val value: String = "redirect" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : ResponseShape {
        init {
            require(ResponseShape.known.none { it.value == value }) { "ResponseShape.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<ResponseShape> by lazy { listOf(ITEM, TABLE, LIST, PAGE, EMPTY, BINARY, REDIRECT) }

        public fun of(value: String): ResponseShape = when (value) {
            "item" -> ITEM
            "table" -> TABLE
            "list" -> LIST
            "page" -> PAGE
            "empty" -> EMPTY
            "binary" -> BINARY
            "redirect" -> REDIRECT
            else -> Unknown(value)
        }
    }
}

internal object ResponseShapeSerializer : IrOpenEnumSerializer<ResponseShape>("ResponseShape", ResponseShape::of, ResponseShape::value)

/** The retry header of a 429 from a bucket rule (grammar 13, rateLimit). */
@Serializable
public data class RetryHeader(
    public val name: String,
    /** The required member of the code's params holding the delay in integer milliseconds. */
    public val param: String,
    public val unit: RetryUnit,
    public val derivedFrom: DerivedFrom,
)

/** The unit of a retry header; 's' rounds the millisecond delay up. */
@Serializable(with = RetryUnitSerializer::class)
public sealed interface RetryUnit {
    public val value: String

    public data object S : RetryUnit { override val value: String = "s" }
    public data object MS : RetryUnit { override val value: String = "ms" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : RetryUnit {
        init {
            require(RetryUnit.known.none { it.value == value }) { "RetryUnit.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<RetryUnit> by lazy { listOf(S, MS) }

        public fun of(value: String): RetryUnit = when (value) {
            "s" -> S
            "ms" -> MS
            else -> Unknown(value)
        }
    }
}

internal object RetryUnitSerializer : IrOpenEnumSerializer<RetryUnit>("RetryUnit", RetryUnit::of, RetryUnit::value)

@Serializable
public data class RightRequirement(
    @Required @EncodeDefault public override val kind: String = "right",
    public val right: RightId,
    /** Values already validated against the right's params schema. */
    @Serializable(with = IrOptionalOpaqueSerializer::class) public val params: JsonElement? = null,
    public val subject: RequirementSubject? = null,
    /** The 'requirements' entry it was written through. */
    public val entry: String? = null,
    public val origin: Origin? = null,
    public val derivedFrom: DerivedFrom? = null,
) : Requirement {
    init {
        require(kind == "right") { "RightRequirement: kind is \"right\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class RuleRequirement(
    @Required @EncodeDefault public override val kind: String = "rule",
    public val rule: RuleId,
    /** Values already validated against the rule's params schema. */
    @Serializable(with = IrOptionalOpaqueSerializer::class) public val params: JsonElement? = null,
    public val bucket: BucketId? = null,
    /** The 'requirements' entry it was written through. */
    public val entry: String? = null,
    public val origin: Origin? = null,
    public val derivedFrom: DerivedFrom? = null,
) : Requirement {
    init {
        require(kind == "rule") { "RuleRequirement: kind is \"rule\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class SortKey(
    public val key: String,
    public val right: RightId? = null,
    /** The params of 'right', validated against the right's params schema; only with 'right' (ADR 0002 section 10). */
    @Serializable(with = IrOptionalOpaqueSerializer::class) public val params: JsonElement? = null,
    /** Where the right's subject is read on the request; only with 'right' (ADR 0003 section 6). */
    public val subject: FieldRightSubject? = null,
    public val derivedFrom: DerivedFrom? = null,
    public val origin: Origin? = null,
)

/** Undeclared query keys. Must act: an unknown tag makes the IR invalid for every reader. */
@Serializable(with = UnknownQuerySerializer::class)
public sealed interface UnknownQuery {
    /** The tag member 'policy': it picks the variant. */
    public val policy: String

    /** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
    public data class Unknown(override val policy: String, public val raw: JsonObject) : UnknownQuery {
        init {
            require(policy !in setOf("refuse", "ignore")) { "UnknownQuery.Unknown: \"" + policy + "\" is a known policy" }
            require(raw["policy"] == JsonPrimitive(policy)) { "UnknownQuery.Unknown: raw's policy is not \"" + policy + "\"" }
        }
    }
}

internal object UnknownQuerySerializer : IrUnionSerializer<UnknownQuery>("UnknownQuery", "policy") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): UnknownQuery? = when (tag) {
        "refuse" -> json.decodeFromJsonElement(RefuseUnknownQuery.serializer(), element)
        "ignore" -> json.decodeFromJsonElement(IgnoreUnknownQuery.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): UnknownQuery = UnknownQuery.Unknown(tag, element)

    override fun encode(json: Json, value: UnknownQuery): JsonElement = when (value) {
        is RefuseUnknownQuery -> json.encodeToJsonElement(RefuseUnknownQuery.serializer(), value)
        is IgnoreUnknownQuery -> json.encodeToJsonElement(IgnoreUnknownQuery.serializer(), value)
        is UnknownQuery.Unknown -> value.raw
    }
}
