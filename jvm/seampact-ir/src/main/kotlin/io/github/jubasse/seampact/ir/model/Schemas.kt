// Generated from packages/core/spec/schemas/ir/schemas.schema.json by scripts/ir-models for IR revision 6. Do not edit.
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

@Serializable
public data class ArrayTypeUse(
    @Required @EncodeDefault public override val kind: String = "array",
    public val items: TypeUse,
    public val minItems: Long? = null,
    public val maxItems: Long? = null,
    /** The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable). */
    public val nullable: Boolean? = null,
    /** The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own. */
    public val docs: Docs? = null,
    /** The examples written at the position of this use, placed as its docs are. */
    public val examples: List<JsonElement>? = null,
) : TypeUse {
    init {
        require(kind == "array") { "ArrayTypeUse: kind is \"array\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class BodyUnionTag(
    @SerialName("in") @Required @EncodeDefault public override val in_: String = "body",
    public val property: String,
) : UnionTag {
    init {
        require(in_ == "body") { "BodyUnionTag: in is \"body\", got \"" + in_ + "\"" }
    }
}

/** A number written as a decimal literal string, so an int64 or decimal bound and a long multipleOf keep every digit in every language (ADR 0003 section 8). */
public typealias DecimalLiteral = String

@Serializable
public data class EnumNarrowing(
    public val values: List<String>,
    public val reason: Reason? = null,
)

@Serializable
public data class EnumTypeUse(
    @Required @EncodeDefault public override val kind: String = "enum",
    public val enum: EnumId,
    public val narrowedTo: EnumNarrowing? = null,
    /** The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable). */
    public val nullable: Boolean? = null,
    /** The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own. */
    public val docs: Docs? = null,
    /** The examples written at the position of this use, placed as its docs are. */
    public val examples: List<JsonElement>? = null,
) : TypeUse {
    init {
        require(kind == "enum") { "EnumTypeUse: kind is \"enum\", got \"" + kind + "\"" }
    }
}

/** A restrictedTo mark (ADR 0003 section 6). */
@Serializable
public data class FieldRestriction(
    public val right: RightId,
    @Serializable(with = IrOptionalOpaqueSerializer::class) public val params: JsonElement? = null,
    public val inputPolicy: InputPolicy? = null,
    public val origin: Origin? = null,
)

/** A multipart field or a download (A39). */
@Serializable
public data class FileTypeUse(
    @Required @EncodeDefault public override val kind: String = "file",
    public val media: List<String>,
    public val maxSizeBytes: Long? = null,
    /** The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable). */
    public val nullable: Boolean? = null,
    /** The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own. */
    public val docs: Docs? = null,
    /** The examples written at the position of this use, placed as its docs are. */
    public val examples: List<JsonElement>? = null,
) : TypeUse {
    init {
        require(kind == "file") { "FileTypeUse: kind is \"file\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class HeaderUnionTag(
    @SerialName("in") @Required @EncodeDefault public override val in_: String = "header",
    public val name: String,
) : UnionTag {
    init {
        require(in_ == "header") { "HeaderUnionTag: in is \"header\", got \"" + in_ + "\"" }
    }
}

/** What the boundary does with a restricted input field sent without the right (A21). Must act: an unknown value makes the IR invalid for every reader. */
@Serializable(with = InputPolicySerializer::class)
public sealed interface InputPolicy {
    public val value: String

    public data object REJECT : InputPolicy { override val value: String = "reject" }
    public data object STRIP : InputPolicy { override val value: String = "strip" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : InputPolicy {
        init {
            require(InputPolicy.known.none { it.value == value }) { "InputPolicy.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<InputPolicy> by lazy { listOf(REJECT, STRIP) }

        public fun of(value: String): InputPolicy = when (value) {
            "reject" -> REJECT
            "strip" -> STRIP
            else -> Unknown(value)
        }
    }
}

internal object InputPolicySerializer : IrOpenEnumSerializer<InputPolicy>("InputPolicy", InputPolicy::of, InputPolicy::value)

/** A form or multipart text field holding JSON. */
@Serializable
public data class JsonContent(
    public val media: JsonMediaType,
    public val schema: TypeUse,
)

/** The media type of a JSON text field. */
@Serializable(with = JsonMediaTypeSerializer::class)
public sealed interface JsonMediaType {
    public val value: String

    public data object APPLICATION_JSON : JsonMediaType { override val value: String = "application/json" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : JsonMediaType {
        init {
            require(JsonMediaType.known.none { it.value == value }) { "JsonMediaType.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<JsonMediaType> by lazy { listOf(APPLICATION_JSON) }

        public fun of(value: String): JsonMediaType = when (value) {
            "application/json" -> APPLICATION_JSON
            else -> Unknown(value)
        }
    }
}

internal object JsonMediaTypeSerializer : IrOpenEnumSerializer<JsonMediaType>("JsonMediaType", JsonMediaType::of, JsonMediaType::value)

@Serializable
public data class MapSchema(
    @Required @EncodeDefault public override val kind: String = "map",
    public val keys: TypeUse? = null,
    public val values: TypeUse,
    public val id: SchemaId,
    public val name: Name,
    public val typeName: String? = null,
    public val directions: List<Direction>,
    public val examples: List<JsonElement>,
    public val docs: Docs,
    public val extensions: Extensions,
    public val origin: Origin,
    /** The schema is deprecated (ADR 0003 section 1); absent means false. */
    public val deprecated: Boolean? = null,
) : Schema {
    init {
        require(kind == "map") { "MapSchema: kind is \"map\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class ObjectSchema(
    @Required @EncodeDefault public override val kind: String = "object",
    public val properties: List<Property>,
    public val id: SchemaId,
    public val name: Name,
    public val typeName: String? = null,
    public val directions: List<Direction>,
    public val examples: List<JsonElement>,
    public val docs: Docs,
    public val extensions: Extensions,
    public val origin: Origin,
    /** The schema is deprecated (ADR 0003 section 1); absent means false. */
    public val deprecated: Boolean? = null,
) : Schema {
    init {
        require(kind == "object") { "ObjectSchema: kind is \"object\", got \"" + kind + "\"" }
    }
}

/** Any JSON value, unchecked (ADR 0003 section 2). */
@Serializable
public data class OpaqueTypeUse(
    @Required @EncodeDefault public override val kind: String = "opaque",
    public val reason: Reason,
    public val origin: Origin,
    /** The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own. */
    public val docs: Docs? = null,
    /** The examples written at the position of this use, placed as its docs are. */
    public val examples: List<JsonElement>? = null,
    /** The value may be JSON null (ADR 0003 section 2): an opaque value accepts null only with it; absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable). */
    public val nullable: Boolean? = null,
) : TypeUse {
    init {
        require(kind == "opaque") { "OpaqueTypeUse: kind is \"opaque\", got \"" + kind + "\"" }
    }
}

/** A pattern refinement: the written text and its normalised form (ADR 0003 section 9). */
@Serializable
public data class Pattern(
    public val source: String,
    public val normalized: String,
)

/** An object property; the wire name stays 'name' (ADR 0004 section 5). */
@Serializable
public data class Property(
    public val name: String,
    public val type: TypeUse,
    public val optional: Boolean,
    public val nullable: Boolean,
    public val sensitive: Boolean,
    public val restrictedTo: FieldRestriction? = null,
    @Serializable(with = IrOptionalOpaqueSerializer::class) public val default: JsonElement? = null,
    public val deprecated: Boolean,
    public val codeName: Name? = null,
    public val docs: Docs,
    public val extensions: Extensions,
    public val origin: Origin,
    public val derivedFrom: DerivedFrom? = null,
    /** The examples written on the property, each parsed against its type (ADR 0003 section 11). */
    public val examples: List<JsonElement>? = null,
)

@Serializable
public data class RefTypeUse(
    @Required @EncodeDefault public override val kind: String = "ref",
    public val schema: SchemaId,
    public val unknownKeys: UnknownKeys? = null,
    /** The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable). */
    public val nullable: Boolean? = null,
    /** The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own. */
    public val docs: Docs? = null,
    /** The examples written at the position of this use, placed as its docs are. */
    public val examples: List<JsonElement>? = null,
) : TypeUse {
    init {
        require(kind == "ref") { "RefTypeUse: kind is \"ref\", got \"" + kind + "\"" }
    }
}

/** The refinements of a scalar (ADR 0003 sections 1 and 8); numeric ones are decimal literal strings, compared numerically. */
@Serializable
public data class Refinements(
    public val minLength: Long? = null,
    public val maxLength: Long? = null,
    public val pattern: Pattern? = null,
    public val minimum: DecimalLiteral? = null,
    public val maximum: DecimalLiteral? = null,
    public val exclusiveMinimum: DecimalLiteral? = null,
    public val exclusiveMaximum: DecimalLiteral? = null,
    public val multipleOf: DecimalLiteral? = null,
)

/** A named format of the scalars catalogue: a base type plus refinements (ADR 0003 section 8). Its own type holds no 'scalar'. */
@Serializable
public data class Scalar(
    public val id: ScalarId,
    public val name: Name,
    public val type: ScalarTypeUse,
    public val directions: List<Direction>,
    public val docs: Docs,
    public val origin: Origin,
)

/** The JSON type of a scalar. */
@Serializable(with = ScalarTypeSerializer::class)
public sealed interface ScalarType {
    public val value: String

    public data object STRING : ScalarType { override val value: String = "string" }
    public data object INTEGER : ScalarType { override val value: String = "integer" }
    public data object NUMBER : ScalarType { override val value: String = "number" }
    public data object BOOLEAN : ScalarType { override val value: String = "boolean" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : ScalarType {
        init {
            require(ScalarType.known.none { it.value == value }) { "ScalarType.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<ScalarType> by lazy { listOf(STRING, INTEGER, NUMBER, BOOLEAN) }

        public fun of(value: String): ScalarType = when (value) {
            "string" -> STRING
            "integer" -> INTEGER
            "number" -> NUMBER
            "boolean" -> BOOLEAN
            else -> Unknown(value)
        }
    }
}

internal object ScalarTypeSerializer : IrOpenEnumSerializer<ScalarType>("ScalarType", ScalarType::of, ScalarType::value)

/** A scalar use. A use of a named format names it in 'scalar' and holds its type and refinements inline, so a target that does not map the named format still checks it (ADR 0003 section 8). */
@Serializable
public data class ScalarTypeUse(
    @Required @EncodeDefault public override val kind: String = "scalar",
    public val type: ScalarType,
    /** A portable format of ADR 0003 section 8 ('uuid', 'int64', 'decimal'...); a named format is 'scalar'. */
    public val format: String? = null,
    /** The named format this use reads, from the scalars catalogue. */
    public val scalar: ScalarId? = null,
    public val refinements: Refinements,
    public val content: JsonContent? = null,
    /** The value is secret (ADR 0003 section 6): a use of a declared scalar marked sensitive; absent means false. A property's own type use leaves it out: Property.sensitive holds it (invariant ir.property.sensitive). A response carrying it is no-store (invariant ir.cache.sensitive-no-store). */
    public val sensitive: Boolean? = null,
    /** The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable). */
    public val nullable: Boolean? = null,
    /** The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own. */
    public val docs: Docs? = null,
    /** The examples written at the position of this use, placed as its docs are. */
    public val examples: List<JsonElement>? = null,
) : TypeUse {
    init {
        require(kind == "scalar") { "ScalarTypeUse: kind is \"scalar\", got \"" + kind + "\"" }
    }
}

/** A named schema: objects, maps and unions are always named (ADR 0004 section 5). */
@Serializable(with = SchemaSerializer::class)
public sealed interface Schema {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : Schema {
        init {
            require(kind !in setOf("object", "map", "union")) { "Schema.Unknown: \"" + kind + "\" is a known kind" }
            require(raw["kind"] == JsonPrimitive(kind)) { "Schema.Unknown: raw's kind is not \"" + kind + "\"" }
        }
    }
}

internal object SchemaSerializer : IrUnionSerializer<Schema>("Schema", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): Schema? = when (tag) {
        "object" -> json.decodeFromJsonElement(ObjectSchema.serializer(), element)
        "map" -> json.decodeFromJsonElement(MapSchema.serializer(), element)
        "union" -> json.decodeFromJsonElement(UnionSchema.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): Schema = Schema.Unknown(tag, element)

    override fun encode(json: Json, value: Schema): JsonElement = when (value) {
        is ObjectSchema -> json.encodeToJsonElement(ObjectSchema.serializer(), value)
        is MapSchema -> json.encodeToJsonElement(MapSchema.serializer(), value)
        is UnionSchema -> json.encodeToJsonElement(UnionSchema.serializer(), value)
        is Schema.Unknown -> value.raw
    }
}

/** What a property, item, body or parameter is (ADR 0004 section 5). */
@Serializable(with = TypeUseSerializer::class)
public sealed interface TypeUse {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : TypeUse {
        init {
            require(kind !in setOf("ref", "opaque", "file", "enum", "scalar", "array")) { "TypeUse.Unknown: \"" + kind + "\" is a known kind" }
            require(raw["kind"] == JsonPrimitive(kind)) { "TypeUse.Unknown: raw's kind is not \"" + kind + "\"" }
        }
    }
}

internal object TypeUseSerializer : IrUnionSerializer<TypeUse>("TypeUse", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): TypeUse? = when (tag) {
        "ref" -> json.decodeFromJsonElement(RefTypeUse.serializer(), element)
        "opaque" -> json.decodeFromJsonElement(OpaqueTypeUse.serializer(), element)
        "file" -> json.decodeFromJsonElement(FileTypeUse.serializer(), element)
        "enum" -> json.decodeFromJsonElement(EnumTypeUse.serializer(), element)
        "scalar" -> json.decodeFromJsonElement(ScalarTypeUse.serializer(), element)
        "array" -> json.decodeFromJsonElement(ArrayTypeUse.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): TypeUse = TypeUse.Unknown(tag, element)

    override fun encode(json: Json, value: TypeUse): JsonElement = when (value) {
        is RefTypeUse -> json.encodeToJsonElement(RefTypeUse.serializer(), value)
        is OpaqueTypeUse -> json.encodeToJsonElement(OpaqueTypeUse.serializer(), value)
        is FileTypeUse -> json.encodeToJsonElement(FileTypeUse.serializer(), value)
        is EnumTypeUse -> json.encodeToJsonElement(EnumTypeUse.serializer(), value)
        is ScalarTypeUse -> json.encodeToJsonElement(ScalarTypeUse.serializer(), value)
        is ArrayTypeUse -> json.encodeToJsonElement(ArrayTypeUse.serializer(), value)
        is TypeUse.Unknown -> value.raw
    }
}

@Serializable
public data class UnionSchema(
    @Required @EncodeDefault public override val kind: String = "union",
    public val tag: UnionTag,
    public val variants: List<UnionVariant>,
    public val id: SchemaId,
    public val name: Name,
    public val typeName: String? = null,
    public val directions: List<Direction>,
    public val examples: List<JsonElement>,
    public val docs: Docs,
    public val extensions: Extensions,
    public val origin: Origin,
    /** The schema is deprecated (ADR 0003 section 1); absent means false. */
    public val deprecated: Boolean? = null,
) : Schema {
    init {
        require(kind == "union") { "UnionSchema: kind is \"union\", got \"" + kind + "\"" }
    }
}

/** Where a union's tag is read; 'header' only for a route's whole input. */
@Serializable(with = UnionTagSerializer::class)
public sealed interface UnionTag {
    /** The tag member 'in': it picks the variant. */
    public val in_: String

    /** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
    public data class Unknown(override val in_: String, public val raw: JsonObject) : UnionTag {
        init {
            require(in_ !in setOf("body", "header")) { "UnionTag.Unknown: \"" + in_ + "\" is a known in" }
            require(raw["in"] == JsonPrimitive(in_)) { "UnionTag.Unknown: raw's in is not \"" + in_ + "\"" }
        }
    }
}

internal object UnionTagSerializer : IrUnionSerializer<UnionTag>("UnionTag", "in") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): UnionTag? = when (tag) {
        "body" -> json.decodeFromJsonElement(BodyUnionTag.serializer(), element)
        "header" -> json.decodeFromJsonElement(HeaderUnionTag.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): UnionTag = UnionTag.Unknown(tag, element)

    override fun encode(json: Json, value: UnionTag): JsonElement = when (value) {
        is BodyUnionTag -> json.encodeToJsonElement(BodyUnionTag.serializer(), value)
        is HeaderUnionTag -> json.encodeToJsonElement(HeaderUnionTag.serializer(), value)
        is UnionTag.Unknown -> value.raw
    }
}

@Serializable
public data class UnionVariant(
    public val tag: String,
    public val schema: SchemaId,
    /** The docs written on the variant itself, beside its schema reference. */
    public val docs: Docs? = null,
)

/** Unknown keys of an input use (ADR 0003 section 4). */
@Serializable
public data class UnknownKeys(
    public val policy: UnknownKeysPolicy,
    public val reason: Reason? = null,
    public val origin: Origin? = null,
    public val derivedFrom: DerivedFrom? = null,
)

/** What an input use does with unknown keys (ADR 0003 section 4). Must act: an unknown value makes the IR invalid for every reader. */
@Serializable(with = UnknownKeysPolicySerializer::class)
public sealed interface UnknownKeysPolicy {
    public val value: String

    public data object REFUSE : UnknownKeysPolicy { override val value: String = "refuse" }
    public data object IGNORE : UnknownKeysPolicy { override val value: String = "ignore" }
    public data object KEEP : UnknownKeysPolicy { override val value: String = "keep" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : UnknownKeysPolicy {
        init {
            require(UnknownKeysPolicy.known.none { it.value == value }) { "UnknownKeysPolicy.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<UnknownKeysPolicy> by lazy { listOf(REFUSE, IGNORE, KEEP) }

        public fun of(value: String): UnknownKeysPolicy = when (value) {
            "refuse" -> REFUSE
            "ignore" -> IGNORE
            "keep" -> KEEP
            else -> Unknown(value)
        }
    }
}

internal object UnknownKeysPolicySerializer : IrOpenEnumSerializer<UnknownKeysPolicy>("UnknownKeysPolicy", UnknownKeysPolicy::of, UnknownKeysPolicy::value)
