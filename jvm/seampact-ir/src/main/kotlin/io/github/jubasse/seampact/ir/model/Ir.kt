// Generated from packages/core/spec/schemas/ir/ir.schema.json by scripts/ir-models for IR revision 6. Do not edit.
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

/** The api (ADR 0004 section 2). */
@Serializable
public data class Api(
    public val id: String,
    public val name: Name,
    public val version: ApiVersion,
    public val kind: ApiKind,
    public val pathVersion: PathVersion,
    public val role: ApiRole? = null,
    public val maturity: Maturity,
    public val caller: ApiCaller? = null,
    public val compat: Compat,
    public val wire: ApiWire,
    public val surfaces: Map<SurfaceId, Surface>,
    public val documents: Map<DocumentId, ApiDocument>,
    public val docs: Docs,
    public val extensions: Extensions,
    public val origin: Origin,
)

@Serializable
public data class ApiCaller(
    public val identity: IdentityId,
    public val right: RightId,
)

@Serializable
public data class ApiDocument(
    public val surfaces: List<SurfaceId>,
    public val internal: InternalPolicy,
)

/** A product api or a service api. */
@Serializable(with = ApiKindSerializer::class)
public sealed interface ApiKind {
    public val value: String

    public data object PRODUCT : ApiKind { override val value: String = "product" }
    public data object SERVICE : ApiKind { override val value: String = "service" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : ApiKind {
        init {
            require(ApiKind.known.none { it.value == value }) { "ApiKind.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<ApiKind> by lazy { listOf(PRODUCT, SERVICE) }

        public fun of(value: String): ApiKind = when (value) {
            "product" -> PRODUCT
            "service" -> SERVICE
            else -> Unknown(value)
        }
    }
}

internal object ApiKindSerializer : IrOpenEnumSerializer<ApiKind>("ApiKind", ApiKind::of, ApiKind::value)

/** The role of an api. */
@Serializable(with = ApiRoleSerializer::class)
public sealed interface ApiRole {
    public val value: String

    public data object GATEWAY : ApiRole { override val value: String = "gateway" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : ApiRole {
        init {
            require(ApiRole.known.none { it.value == value }) { "ApiRole.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<ApiRole> by lazy { listOf(GATEWAY) }

        public fun of(value: String): ApiRole = when (value) {
            "gateway" -> GATEWAY
            else -> Unknown(value)
        }
    }
}

internal object ApiRoleSerializer : IrOpenEnumSerializer<ApiRole>("ApiRole", ApiRole::of, ApiRole::value)

/** The api version: the path version number, or a label when every surface's pathVersion is 'none'. */
@Serializable(with = ApiVersionSerializer::class)
public sealed interface ApiVersion {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : ApiVersion {
        init {
            require(kind !in setOf("path", "label")) { "ApiVersion.Unknown: \"" + kind + "\" is a known kind" }
            require(raw["kind"] == JsonPrimitive(kind)) { "ApiVersion.Unknown: raw's kind is not \"" + kind + "\"" }
        }
    }
}

internal object ApiVersionSerializer : IrUnionSerializer<ApiVersion>("ApiVersion", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): ApiVersion? = when (tag) {
        "path" -> json.decodeFromJsonElement(PathApiVersion.serializer(), element)
        "label" -> json.decodeFromJsonElement(LabelApiVersion.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): ApiVersion = ApiVersion.Unknown(tag, element)

    override fun encode(json: Json, value: ApiVersion): JsonElement = when (value) {
        is PathApiVersion -> json.encodeToJsonElement(PathApiVersion.serializer(), value)
        is LabelApiVersion -> json.encodeToJsonElement(LabelApiVersion.serializer(), value)
        is ApiVersion.Unknown -> value.raw
    }
}

/** The api-wide conventions a target acts on (ADR 0004 section 13). */
@Serializable
public data class ApiWire(
    public val int64: Int64Wire,
    public val outputEnums: OutputEnumForm,
    public val urls: UrlForm,
)

@Serializable
public data class Compat(
    public val policy: CompatPolicy,
)

/** The compatibility policy the diff checks. */
@Serializable(with = CompatPolicySerializer::class)
public sealed interface CompatPolicy {
    public val value: String

    public data object ADDITIVE_ONLY : CompatPolicy { override val value: String = "additive-only" }
    public data object NONE : CompatPolicy { override val value: String = "none" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : CompatPolicy {
        init {
            require(CompatPolicy.known.none { it.value == value }) { "CompatPolicy.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<CompatPolicy> by lazy { listOf(ADDITIVE_ONLY, NONE) }

        public fun of(value: String): CompatPolicy = when (value) {
            "additive-only" -> ADDITIVE_ONLY
            "none" -> NONE
            else -> Unknown(value)
        }
    }
}

internal object CompatPolicySerializer : IrOpenEnumSerializer<CompatPolicy>("CompatPolicy", CompatPolicy::of, CompatPolicy::value)

/** One IR document per api (ADR 0004 sections 1 and 2). */
@Serializable
public data class ContractIR(
    /** 1 until 1.0 and through 1.x (ADR 0005 section 2). */
    public val irVersion: Long,
    /** Rises by one with every IR change (ADR 0005 section 2). */
    public val irRevision: Long,
    public val kinds: List<DeclarationKind>,
    public val features: List<Feature>,
    public val api: Api,
    public val packs: List<PackRef>,
    public val conventions: Conventions,
    public val formats: Map<FormatId, WireFormat>,
    public val pagings: Map<PagingId, PagingStyle>,
    public val schemas: Map<SchemaId, Schema>,
    public val scalars: Map<ScalarId, Scalar>,
    public val enums: Map<EnumId, Enum_>,
    public val errors: Map<ErrorCode, ErrorDecl>,
    public val natures: Map<NatureId, NatureDecl>,
    public val schemes: Map<SchemeId, Scheme>,
    public val headers: Map<HeaderId, HeaderDecl>,
    public val identities: Map<IdentityId, Identity>,
    public val rights: Map<RightId, Right>,
    public val rules: Map<RuleId, Rule>,
    public val scopes: Map<ScopeId, Scope>,
    public val buckets: Map<BucketId, Bucket>,
    public val services: Map<ServiceId, Service>,
    public val extensionKeys: Map<ExtensionKeyId, ExtensionKeyDecl>,
    public val lint: Lint,
    public val operations: List<Operation>,
)

/** A resolved convention value with the origin of the node that set it. */
@Serializable
public data class ConventionValue(
    public val value: JsonElement,
    public val origin: Origin,
)

/** Resolved conventions, keyed by the dotted path of the convention under 'conventions' (for example 'pathVersion', 'idempotency.header'). Informative only: provenance for explain and lint. A target never acts on a convention; every convention a target acts on is a typed member (ADR 0004 section 13). */
public typealias Conventions = Map<String, ConventionValue>

/** A declared extension key (ADR 0002 section 12). */
@Serializable
public data class ExtensionKeyDecl(
    public val id: ExtensionKeyId,
    public val prefix: ExtensionPrefix,
    public val key: ExtensionKey,
    public val schema: TypeUse,
    public val places: List<ExtensionPlace>,
    public val origin: Origin,
)

/** Where an extension key may appear (ADR 0002 section 12). */
@Serializable(with = ExtensionPlaceSerializer::class)
public sealed interface ExtensionPlace {
    public val value: String

    public data object API : ExtensionPlace { override val value: String = "api" }
    public data object OPERATION : ExtensionPlace { override val value: String = "operation" }
    public data object SCHEMA : ExtensionPlace { override val value: String = "schema" }
    public data object PROPERTY : ExtensionPlace { override val value: String = "property" }
    public data object RIGHT : ExtensionPlace { override val value: String = "right" }
    public data object RULE : ExtensionPlace { override val value: String = "rule" }
    public data object SCOPE : ExtensionPlace { override val value: String = "scope" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : ExtensionPlace {
        init {
            require(ExtensionPlace.known.none { it.value == value }) { "ExtensionPlace.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<ExtensionPlace> by lazy { listOf(API, OPERATION, SCHEMA, PROPERTY, RIGHT, RULE, SCOPE) }

        public fun of(value: String): ExtensionPlace = when (value) {
            "api" -> API
            "operation" -> OPERATION
            "schema" -> SCHEMA
            "property" -> PROPERTY
            "right" -> RIGHT
            "rule" -> RULE
            "scope" -> SCOPE
            else -> Unknown(value)
        }
    }
}

internal object ExtensionPlaceSerializer : IrOpenEnumSerializer<ExtensionPlace>("ExtensionPlace", ExtensionPlace::of, ExtensionPlace::value)

/** How an int64 value is sent: its string form, or a JSON number. */
@Serializable(with = Int64WireSerializer::class)
public sealed interface Int64Wire {
    public val value: String

    public data object STRING : Int64Wire { override val value: String = "string" }
    public data object NUMBER : Int64Wire { override val value: String = "number" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : Int64Wire {
        init {
            require(Int64Wire.known.none { it.value == value }) { "Int64Wire.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<Int64Wire> by lazy { listOf(STRING, NUMBER) }

        public fun of(value: String): Int64Wire = when (value) {
            "string" -> STRING
            "number" -> NUMBER
            else -> Unknown(value)
        }
    }
}

internal object Int64WireSerializer : IrOpenEnumSerializer<Int64Wire>("Int64Wire", Int64Wire::of, Int64Wire::value)

/** Whether a document lists internal operations. */
@Serializable(with = InternalPolicySerializer::class)
public sealed interface InternalPolicy {
    public val value: String

    public data object INCLUDE : InternalPolicy { override val value: String = "include" }
    public data object EXCLUDE : InternalPolicy { override val value: String = "exclude" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : InternalPolicy {
        init {
            require(InternalPolicy.known.none { it.value == value }) { "InternalPolicy.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<InternalPolicy> by lazy { listOf(INCLUDE, EXCLUDE) }

        public fun of(value: String): InternalPolicy = when (value) {
            "include" -> INCLUDE
            "exclude" -> EXCLUDE
            else -> Unknown(value)
        }
    }
}

internal object InternalPolicySerializer : IrOpenEnumSerializer<InternalPolicy>("InternalPolicy", InternalPolicy::of, InternalPolicy::value)

@Serializable
public data class LabelApiVersion(
    @Required @EncodeDefault public override val kind: String = "label",
    public val label: String,
) : ApiVersion {
    init {
        require(kind == "label") { "LabelApiVersion: kind is \"label\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class Lint(
    public val rules: Map<String, LintRule>,
    public val allows: List<LintAllow>,
)

/** An allow of ADR 0002 section 12. */
@Serializable
public data class LintAllow(
    public val rule: String,
    public val at: Origin,
    public val reason: Reason,
    public val subtree: Boolean,
)

/** A resolved lint severity. */
@Serializable
public data class LintRule(
    public val severity: LintSeverity,
    public val origin: Origin,
)

/** A lint severity. */
@Serializable(with = LintSeveritySerializer::class)
public sealed interface LintSeverity {
    public val value: String

    public data object DISABLED : LintSeverity { override val value: String = "disabled" }
    public data object WARNING : LintSeverity { override val value: String = "warning" }
    public data object ERROR : LintSeverity { override val value: String = "error" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : LintSeverity {
        init {
            require(LintSeverity.known.none { it.value == value }) { "LintSeverity.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<LintSeverity> by lazy { listOf(DISABLED, WARNING, ERROR) }

        public fun of(value: String): LintSeverity = when (value) {
            "disabled" -> DISABLED
            "warning" -> WARNING
            "error" -> ERROR
            else -> Unknown(value)
        }
    }
}

internal object LintSeveritySerializer : IrOpenEnumSerializer<LintSeverity>("LintSeverity", LintSeverity::of, LintSeverity::value)

/** Whether an output enum is closed, or open with a fallback a client keeps. */
@Serializable(with = OutputEnumFormSerializer::class)
public sealed interface OutputEnumForm {
    public val value: String

    public data object ENUM : OutputEnumForm { override val value: String = "enum" }
    public data object OPEN : OutputEnumForm { override val value: String = "open" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : OutputEnumForm {
        init {
            require(OutputEnumForm.known.none { it.value == value }) { "OutputEnumForm.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<OutputEnumForm> by lazy { listOf(ENUM, OPEN) }

        public fun of(value: String): OutputEnumForm = when (value) {
            "enum" -> ENUM
            "open" -> OPEN
            else -> Unknown(value)
        }
    }
}

internal object OutputEnumFormSerializer : IrOpenEnumSerializer<OutputEnumForm>("OutputEnumForm", OutputEnumForm::of, OutputEnumForm::value)

/** A pack applied, in application order. */
@Serializable
public data class PackRef(
    public val name: String,
    public val version: String,
)

@Serializable
public data class PathApiVersion(
    @Required @EncodeDefault public override val kind: String = "path",
    /** The number paths carry ('/v1'). */
    public val number: Long,
) : ApiVersion {
    init {
        require(kind == "path") { "PathApiVersion: kind is \"path\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class PathVersion(
    public val value: PathVersionMode,
    public val origin: Origin,
)

/** Whether paths carry the version prefix. */
@Serializable(with = PathVersionModeSerializer::class)
public sealed interface PathVersionMode {
    public val value: String

    public data object PREFIX : PathVersionMode { override val value: String = "prefix" }
    public data object NONE : PathVersionMode { override val value: String = "none" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : PathVersionMode {
        init {
            require(PathVersionMode.known.none { it.value == value }) { "PathVersionMode.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<PathVersionMode> by lazy { listOf(PREFIX, NONE) }

        public fun of(value: String): PathVersionMode = when (value) {
            "prefix" -> PREFIX
            "none" -> NONE
            else -> Unknown(value)
        }
    }
}

internal object PathVersionModeSerializer : IrOpenEnumSerializer<PathVersionMode>("PathVersionMode", PathVersionMode::of, PathVersionMode::value)

@Serializable
public data class Surface(
    public val name: Name,
    public val prefix: String,
    public val pathVersion: PathVersionMode,
    public val origin: Origin,
)

/** Whether a URL a target writes is a relative reference, or absolute from one configured public origin. */
@Serializable(with = UrlFormSerializer::class)
public sealed interface UrlForm {
    public val value: String

    public data object RELATIVE : UrlForm { override val value: String = "relative" }
    public data object ABSOLUTE : UrlForm { override val value: String = "absolute" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : UrlForm {
        init {
            require(UrlForm.known.none { it.value == value }) { "UrlForm.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<UrlForm> by lazy { listOf(RELATIVE, ABSOLUTE) }

        public fun of(value: String): UrlForm = when (value) {
            "relative" -> RELATIVE
            "absolute" -> ABSOLUTE
            else -> Unknown(value)
        }
    }
}

internal object UrlFormSerializer : IrOpenEnumSerializer<UrlForm>("UrlForm", UrlForm::of, UrlForm::value)
