// Generated from packages/spec/schemas/ir/common.schema.json by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write
@file:OptIn(ExperimentalSerializationApi::class)
@file:UseSerializers(IrIntegerSerializer::class)

package io.github.jubasse.seampact.ir.model

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** The id of a rate-limit bucket: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
public typealias BucketId = String

/** A declaration kind (ADR 0004 section 2, ADR 0014). */
@Serializable(with = DeclarationKindSerializer::class)
public sealed interface DeclarationKind {
    public val value: String

    public data object HTTP_OPERATION : DeclarationKind { override val value: String = "httpOperation" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : DeclarationKind {
        init {
            require(DeclarationKind.known.none { it.value == value }) { "DeclarationKind.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<DeclarationKind> by lazy { listOf(HTTP_OPERATION) }

        public fun of(value: String): DeclarationKind = when (value) {
            "httpOperation" -> HTTP_OPERATION
            else -> Unknown(value)
        }
    }
}

internal object DeclarationKindSerializer : IrOpenEnumSerializer<DeclarationKind>("DeclarationKind", DeclarationKind::of, DeclarationKind::value)

/** A derivation id of the derivation table (ADR 0006 section 5), 'pack.<pack>.<entry>' for a pack entry. */
public typealias DerivationId = String

/** Present on, and only on, an element the compiler derived (ADR 0004 section 6). */
@Serializable
public data class DerivedFrom(
    public val derivation: DerivationId,
    public val from: List<Origin>,
)

@Serializable(with = DirectionSerializer::class)
public sealed interface Direction {
    public val value: String

    public data object INPUT : Direction { override val value: String = "input" }
    public data object OUTPUT : Direction { override val value: String = "output" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : Direction {
        init {
            require(Direction.known.none { it.value == value }) { "Direction.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<Direction> by lazy { listOf(INPUT, OUTPUT) }

        public fun of(value: String): Direction = when (value) {
            "input" -> INPUT
            "output" -> OUTPUT
            else -> Unknown(value)
        }
    }
}

internal object DirectionSerializer : IrOpenEnumSerializer<Direction>("Direction", Direction::of, Direction::value)

/** Resolved documentation text. */
@Serializable
public data class Docs(
    public val summary: String? = null,
    public val description: String? = null,
)

/** The id of an api document: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
public typealias DocumentId = String

/** The id of an enum: its catalogue key, the name as written or the canonical identifier of a derived name (ADR 0004 section 9, ADR 0002 section 4). */
public typealias EnumId = String

/** An error code, the key of the errors catalogue (ADR 0004 section 4, ADR 0002 section 4). */
public typealias ErrorCode = String

/** An extension key under its prefix (ADR 0002 section 4). */
public typealias ExtensionKey = String

/** A declared extension key, written '<prefix>-<key>' (ADR 0002 sections 4 and 12). */
public typealias ExtensionKeyId = String

/** An extension prefix (ADR 0002 section 4); the compiler refuses 'seampact', which is reserved. */
public typealias ExtensionPrefix = String

/** The extension slot: { '<prefix>': { '<key>': value } } (ADR 0004 section 3). */
public typealias Extensions = JsonObject

/** A must-understand feature name (ADR 0005 section 3); none is defined at irRevision 2. */
public typealias Feature = String

/** The id of a wire format: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
public typealias FormatId = String

/** The id of an identity header: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
public typealias HeaderId = String

/** The id of an identity: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
public typealias IdentityId = String

@Serializable(with = MaturitySerializer::class)
public sealed interface Maturity {
    public val value: String

    public data object EXPERIMENTAL : Maturity { override val value: String = "experimental" }
    public data object PROVISIONAL : Maturity { override val value: String = "provisional" }
    public data object STABLE : Maturity { override val value: String = "stable" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : Maturity {
        init {
            require(Maturity.known.none { it.value == value }) { "Maturity.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<Maturity> by lazy { listOf(EXPERIMENTAL, PROVISIONAL, STABLE) }

        public fun of(value: String): Maturity = when (value) {
            "experimental" -> EXPERIMENTAL
            "provisional" -> PROVISIONAL
            "stable" -> STABLE
            else -> Unknown(value)
        }
    }
}

internal object MaturitySerializer : IrOpenEnumSerializer<Maturity>("Maturity", Maturity::of, Maturity::value)

/** A canonical name: word segments plus a role, never a final identifier (ADR 0007 section 1 and its amendment). */
@Serializable
public data class Name(
    public val segments: List<String>,
    public val role: NameRole,
    /** The HTTP success or redirect status of a 'response' name; present if and only if role is 'response' (invariant ir.name.status, ADR 0004 section 13). */
    public val status: Long? = null,
)

/** The role of a name (ADR 0007 section 1). */
@Serializable(with = NameRoleSerializer::class)
public sealed interface NameRole {
    public val value: String

    public data object SCHEMA : NameRole { override val value: String = "schema" }
    public data object INPUT : NameRole { override val value: String = "input" }
    public data object OUTPUT : NameRole { override val value: String = "output" }
    public data object QUERY : NameRole { override val value: String = "query" }
    public data object HEADERS : NameRole { override val value: String = "headers" }
    public data object PATH : NameRole { override val value: String = "path" }
    public data object RESPONSE : NameRole { override val value: String = "response" }
    public data object PARAMS : NameRole { override val value: String = "params" }
    public data object ERROR : NameRole { override val value: String = "error" }
    public data object ERRORS : NameRole { override val value: String = "errors" }
    public data object PROPERTY : NameRole { override val value: String = "property" }
    public data object ITEM : NameRole { override val value: String = "item" }
    public data object VALUE : NameRole { override val value: String = "value" }
    public data object VARIANT : NameRole { override val value: String = "variant" }
    public data object ENDPOINTS : NameRole { override val value: String = "endpoints" }
    public data object OPERATION : NameRole { override val value: String = "operation" }
    public data object MEMBER : NameRole { override val value: String = "member" }
    public data object ENUM_MEMBER : NameRole { override val value: String = "enumMember" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : NameRole {
        init {
            require(NameRole.known.none { it.value == value }) { "NameRole.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<NameRole> by lazy { listOf(SCHEMA, INPUT, OUTPUT, QUERY, HEADERS, PATH, RESPONSE, PARAMS, ERROR, ERRORS, PROPERTY, ITEM, VALUE, VARIANT, ENDPOINTS, OPERATION, MEMBER, ENUM_MEMBER) }

        public fun of(value: String): NameRole = when (value) {
            "schema" -> SCHEMA
            "input" -> INPUT
            "output" -> OUTPUT
            "query" -> QUERY
            "headers" -> HEADERS
            "path" -> PATH
            "response" -> RESPONSE
            "params" -> PARAMS
            "error" -> ERROR
            "errors" -> ERRORS
            "property" -> PROPERTY
            "item" -> ITEM
            "value" -> VALUE
            "variant" -> VARIANT
            "endpoints" -> ENDPOINTS
            "operation" -> OPERATION
            "member" -> MEMBER
            "enumMember" -> ENUM_MEMBER
            else -> Unknown(value)
        }
    }
}

internal object NameRoleSerializer : IrOpenEnumSerializer<NameRole>("NameRole", NameRole::of, NameRole::value)

/** The id of a contract nature: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
public typealias NatureId = String

/** An operation id (ADR 0004 section 7). */
public typealias OperationId = String

/** Where an element was declared: a JSON Pointer into the merged authoring tree of its layer (ADR 0004 section 6). */
@Serializable
public data class Origin(
    /** Set on an element copied from another api by a relay route. */
    public val api: String? = null,
    /** 'api', 'shared', 'base', 'pack:<name>', 'core' for a declaration the compiler supplies (its pointer starts with its entry of formats, errors or schemas, with no side-table entry), or 'workspace' for a diagnostic on workspace.yaml (no IR element carries it). Closed: the one exception to open enums (ADR 0004 section 13). */
    public val layer: String,
    public val pointer: String,
)

/** The id of a paging style: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
public typealias PagingId = String

/** The written reason of an exception: non-empty, without leading or trailing white space (A36, ADR 0002 section 4). */
public typealias Reason = String

/** The id of a right: its catalogue key, the name its library uses, without line breaks or leading or trailing space (ADR 0002 section 4). */
public typealias RightId = String

/** The id of a rule: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
public typealias RuleId = String

/** The id of a named format: its catalogue key (ADR 0003 section 8, ADR 0002 section 4). */
public typealias ScalarId = String

/** The id of a named schema: its catalogue key, the name as written or the canonical identifier of a derived name (ADR 0004 section 9, ADR 0002 section 4, ADR 0007). */
public typealias SchemaId = String

/** A reference by id to a named object, map or union schema of the schemas catalogue (ADR 0004 section 4). An id, usually a scalar or a named format, is a TypeUse instead. */
public typealias SchemaRef = SchemaId

/** The id of a security scheme: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
public typealias SchemeId = String

/** The id of a scope: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
public typealias ScopeId = String

/** The id of a service: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
public typealias ServiceId = String

/** The id of an api surface: its catalogue key (ADR 0004 section 9, ADR 0002 section 4). */
public typealias SurfaceId = String

/** Where a value is read (ADR 0004 section 7). 'name' with path, query, header, body, principal, scope and holderField (the holder's property); no other member with host, subdomain and resolver; 'prefixBits' only with address (invariants ir.value-source.members and ir.value-source.place). */
@Serializable
public data class ValueSource(
    @SerialName("in") public val in_: ValueSourceIn,
    public val name: String? = null,
    public val prefixBits: Long? = null,
)

/** Where a value is read (ADR 0002 section 4); 'resolver' only as a scope source, 'holderField' only as a field right's subject source. */
@Serializable(with = ValueSourceInSerializer::class)
public sealed interface ValueSourceIn {
    public val value: String

    public data object PATH : ValueSourceIn { override val value: String = "path" }
    public data object QUERY : ValueSourceIn { override val value: String = "query" }
    public data object HEADER : ValueSourceIn { override val value: String = "header" }
    public data object BODY : ValueSourceIn { override val value: String = "body" }
    public data object PRINCIPAL : ValueSourceIn { override val value: String = "principal" }
    public data object SCOPE : ValueSourceIn { override val value: String = "scope" }
    public data object HOST : ValueSourceIn { override val value: String = "host" }
    public data object SUBDOMAIN : ValueSourceIn { override val value: String = "subdomain" }
    public data object ADDRESS : ValueSourceIn { override val value: String = "address" }
    public data object RESOLVER : ValueSourceIn { override val value: String = "resolver" }
    public data object HOLDER_FIELD : ValueSourceIn { override val value: String = "holderField" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : ValueSourceIn {
        init {
            require(ValueSourceIn.known.none { it.value == value }) { "ValueSourceIn.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<ValueSourceIn> by lazy { listOf(PATH, QUERY, HEADER, BODY, PRINCIPAL, SCOPE, HOST, SUBDOMAIN, ADDRESS, RESOLVER, HOLDER_FIELD) }

        public fun of(value: String): ValueSourceIn = when (value) {
            "path" -> PATH
            "query" -> QUERY
            "header" -> HEADER
            "body" -> BODY
            "principal" -> PRINCIPAL
            "scope" -> SCOPE
            "host" -> HOST
            "subdomain" -> SUBDOMAIN
            "address" -> ADDRESS
            "resolver" -> RESOLVER
            "holderField" -> HOLDER_FIELD
            else -> Unknown(value)
        }
    }
}

internal object ValueSourceInSerializer : IrOpenEnumSerializer<ValueSourceIn>("ValueSourceIn", ValueSourceIn::of, ValueSourceIn::value)

/** The id of a principal variant: its catalogue key (ADR 0004 section 9). */
public typealias VariantId = String
