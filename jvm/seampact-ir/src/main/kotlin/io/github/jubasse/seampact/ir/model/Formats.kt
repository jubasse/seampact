// Generated from packages/core/spec/schemas/ir/formats.schema.json by scripts/ir-models for IR revision 6. Do not edit.
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

@Serializable(with = AbsentSerializer::class)
public sealed interface Absent {
    public val value: String

    public data object OMIT : Absent { override val value: String = "omit" }
    public data object NULL : Absent { override val value: String = "null" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : Absent {
        init {
            require(Absent.known.none { it.value == value }) { "Absent.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<Absent> by lazy { listOf(OMIT, NULL) }

        public fun of(value: String): Absent = when (value) {
            "omit" -> OMIT
            "null" -> NULL
            else -> Unknown(value)
        }
    }
}

internal object AbsentSerializer : IrOpenEnumSerializer<Absent>("Absent", Absent::of, Absent::value)

@Serializable
public data class ArrayTemplate(
    @Required @EncodeDefault public override val kind: String = "array",
    public val items: List<Template>,
) : Template {
    init {
        require(kind == "array") { "ArrayTemplate: kind is \"array\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class EachTemplate(
    @Required @EncodeDefault public override val kind: String = "each",
    public val of: Slot,
    @SerialName("as") public val as_: Template,
) : Template {
    init {
        require(kind == "each") { "EachTemplate: kind is \"each\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class ErrorShape(
    public val media: String,
    public val body: Template,
    public val headers: List<HeaderTemplate>,
)

/** What a handler returns beside a page's items. */
@Serializable(with = HandlerResultMemberSerializer::class)
public sealed interface HandlerResultMember {
    public val value: String

    public data object NEXT_CURSOR : HandlerResultMember { override val value: String = "nextCursor" }
    public data object PREVIOUS_CURSOR : HandlerResultMember { override val value: String = "previousCursor" }
    public data object TOTAL : HandlerResultMember { override val value: String = "total" }
    public data object MORE : HandlerResultMember { override val value: String = "more" }
    public data object NEXT_SINCE : HandlerResultMember { override val value: String = "nextSince" }
    public data object COMPLETE : HandlerResultMember { override val value: String = "complete" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : HandlerResultMember {
        init {
            require(HandlerResultMember.known.none { it.value == value }) { "HandlerResultMember.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<HandlerResultMember> by lazy { listOf(NEXT_CURSOR, PREVIOUS_CURSOR, TOTAL, MORE, NEXT_SINCE, COMPLETE) }

        public fun of(value: String): HandlerResultMember = when (value) {
            "nextCursor" -> NEXT_CURSOR
            "previousCursor" -> PREVIOUS_CURSOR
            "total" -> TOTAL
            "more" -> MORE
            "nextSince" -> NEXT_SINCE
            "complete" -> COMPLETE
            else -> Unknown(value)
        }
    }
}

internal object HandlerResultMemberSerializer : IrOpenEnumSerializer<HandlerResultMember>("HandlerResultMember", HandlerResultMember::of, HandlerResultMember::value)

@Serializable
public data class HeaderTemplate(
    public val name: String,
    public val value: Template,
)

@Serializable
public data class LiteralTemplate(
    @Required @EncodeDefault public override val kind: String = "literal",
    public val value: JsonElement,
) : Template {
    init {
        require(kind == "literal") { "LiteralTemplate: kind is \"literal\", got \"" + kind + "\"" }
    }
}

/** The name of an object template member: literal text, or a slot. */
@Serializable(with = MemberNameSerializer::class)
public sealed interface MemberName {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : MemberName {
        init {
            require(kind !in setOf("text", "slot")) { "MemberName.Unknown: \"" + kind + "\" is a known kind" }
            require(raw["kind"] == JsonPrimitive(kind)) { "MemberName.Unknown: raw's kind is not \"" + kind + "\"" }
        }
    }
}

internal object MemberNameSerializer : IrUnionSerializer<MemberName>("MemberName", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): MemberName? = when (tag) {
        "text" -> json.decodeFromJsonElement(PlainMemberName.serializer(), element)
        "slot" -> json.decodeFromJsonElement(SlotMemberName.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): MemberName = MemberName.Unknown(tag, element)

    override fun encode(json: Json, value: MemberName): JsonElement = when (value) {
        is PlainMemberName -> json.encodeToJsonElement(PlainMemberName.serializer(), value)
        is SlotMemberName -> json.encodeToJsonElement(SlotMemberName.serializer(), value)
        is MemberName.Unknown -> value.raw
    }
}

/** Who fills a $meta member; 'source' reads the member 'source'. */
@Serializable(with = MetaFillSerializer::class)
public sealed interface MetaFill {
    public val value: String

    public data object NOW : MetaFill { override val value: String = "now" }
    public data object TRACE_ID : MetaFill { override val value: String = "traceId" }
    public data object DEGRADED : MetaFill { override val value: String = "degraded" }
    public data object HANDLER : MetaFill { override val value: String = "handler" }
    public data object SOURCE : MetaFill { override val value: String = "source" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : MetaFill {
        init {
            require(MetaFill.known.none { it.value == value }) { "MetaFill.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<MetaFill> by lazy { listOf(NOW, TRACE_ID, DEGRADED, HANDLER, SOURCE) }

        public fun of(value: String): MetaFill = when (value) {
            "now" -> NOW
            "traceId" -> TRACE_ID
            "degraded" -> DEGRADED
            "handler" -> HANDLER
            "source" -> SOURCE
            else -> Unknown(value)
        }
    }
}

internal object MetaFillSerializer : IrOpenEnumSerializer<MetaFill>("MetaFill", MetaFill::of, MetaFill::value)

/** A member of the format's $meta: 'source' set if and only if 'fill' is 'source' (invariant ir.meta.source). */
@Serializable
public data class MetaMember(
    public val type: TypeUse,
    public val fill: MetaFill,
    public val source: ValueSource? = null,
)

@Serializable
public data class NamedTemplate(
    public val name: String,
    public val value: Template,
)

@Serializable
public data class ObjectTemplate(
    @Required @EncodeDefault public override val kind: String = "object",
    public val members: List<ObjectTemplateMember>,
    public val merge: Slot? = null,
) : Template {
    init {
        require(kind == "object") { "ObjectTemplate: kind is \"object\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class ObjectTemplateMember(
    public val name: MemberName,
    public val value: Template,
)

@Serializable
public data class PagingLink(
    public val rel: String,
    public val role: UrlRole,
)

/** Where a paging request parameter is read. */
@Serializable(with = PagingParamPlacementSerializer::class)
public sealed interface PagingParamPlacement {
    public val value: String

    public data object QUERY : PagingParamPlacement { override val value: String = "query" }
    public data object HEADER : PagingParamPlacement { override val value: String = "header" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : PagingParamPlacement {
        init {
            require(PagingParamPlacement.known.none { it.value == value }) { "PagingParamPlacement.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<PagingParamPlacement> by lazy { listOf(QUERY, HEADER) }

        public fun of(value: String): PagingParamPlacement = when (value) {
            "query" -> QUERY
            "header" -> HEADER
            else -> Unknown(value)
        }
    }
}

internal object PagingParamPlacementSerializer : IrOpenEnumSerializer<PagingParamPlacement>("PagingParamPlacement", PagingParamPlacement::of, PagingParamPlacement::value)

/** How a sort parameter is written. */
@Serializable(with = PagingParamStyleSerializer::class)
public sealed interface PagingParamStyle {
    public val value: String

    public data object SIGNED : PagingParamStyle { override val value: String = "signed" }
    public data object PAIR : PagingParamStyle { override val value: String = "pair" }
    public data object KEYED : PagingParamStyle { override val value: String = "keyed" }
    public data object SPLIT : PagingParamStyle { override val value: String = "split" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : PagingParamStyle {
        init {
            require(PagingParamStyle.known.none { it.value == value }) { "PagingParamStyle.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<PagingParamStyle> by lazy { listOf(SIGNED, PAIR, KEYED, SPLIT) }

        public fun of(value: String): PagingParamStyle = when (value) {
            "signed" -> SIGNED
            "pair" -> PAIR
            "keyed" -> KEYED
            "split" -> SPLIT
            else -> Unknown(value)
        }
    }
}

internal object PagingParamStyleSerializer : IrOpenEnumSerializer<PagingParamStyle>("PagingParamStyle", PagingParamStyle::of, PagingParamStyle::value)

/** How a paging style positions a page. */
@Serializable(with = PagingPositionSerializer::class)
public sealed interface PagingPosition {
    public val value: String

    public data object CURSOR : PagingPosition { override val value: String = "cursor" }
    public data object PAGE : PagingPosition { override val value: String = "page" }
    public data object OFFSET : PagingPosition { override val value: String = "offset" }
    public data object SINCE : PagingPosition { override val value: String = "since" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : PagingPosition {
        init {
            require(PagingPosition.known.none { it.value == value }) { "PagingPosition.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<PagingPosition> by lazy { listOf(CURSOR, PAGE, OFFSET, SINCE) }

        public fun of(value: String): PagingPosition = when (value) {
            "cursor" -> CURSOR
            "page" -> PAGE
            "offset" -> OFFSET
            "since" -> SINCE
            else -> Unknown(value)
        }
    }
}

internal object PagingPositionSerializer : IrOpenEnumSerializer<PagingPosition>("PagingPosition", PagingPosition::of, PagingPosition::value)

@Serializable
public data class PagingRequestRole(
    public val role: PagingRole,
    @SerialName("in") public val in_: PagingParamPlacement,
    public val name: String,
    public val base: Long? = null,
    public val style: PagingParamStyle? = null,
    /** With style 'split': the direction parameter's name. */
    public val direction: String? = null,
)

@Serializable
public data class PagingResponse(
    /** The whole page body; absent when the style adds 'meta' to the format's page. */
    public val body: Template? = null,
    public val meta: List<NamedTemplate>,
    public val headers: List<HeaderTemplate>,
    public val links: List<PagingLink>,
)

/** The role of a paging request parameter. */
@Serializable(with = PagingRoleSerializer::class)
public sealed interface PagingRole {
    public val value: String

    public data object CURSOR : PagingRole { override val value: String = "cursor" }
    public data object AFTER : PagingRole { override val value: String = "after" }
    public data object BEFORE : PagingRole { override val value: String = "before" }
    public data object PAGE : PagingRole { override val value: String = "page" }
    public data object OFFSET : PagingRole { override val value: String = "offset" }
    public data object SINCE : PagingRole { override val value: String = "since" }
    public data object LIMIT : PagingRole { override val value: String = "limit" }
    public data object SORT : PagingRole { override val value: String = "sort" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : PagingRole {
        init {
            require(PagingRole.known.none { it.value == value }) { "PagingRole.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<PagingRole> by lazy { listOf(CURSOR, AFTER, BEFORE, PAGE, OFFSET, SINCE, LIMIT, SORT) }

        public fun of(value: String): PagingRole = when (value) {
            "cursor" -> CURSOR
            "after" -> AFTER
            "before" -> BEFORE
            "page" -> PAGE
            "offset" -> OFFSET
            "since" -> SINCE
            "limit" -> LIMIT
            "sort" -> SORT
            else -> Unknown(value)
        }
    }
}

internal object PagingRoleSerializer : IrOpenEnumSerializer<PagingRole>("PagingRole", PagingRole::of, PagingRole::value)

/** A paging style (A31). */
@Serializable
public data class PagingStyle(
    public val id: PagingId,
    public val origin: Origin,
    public val position: PagingPosition,
    public val absent: Absent,
    public val request: List<PagingRequestRole>,
    public val response: PagingResponse,
    public val handlerResult: List<HandlerResultMember>,
)

@Serializable
public data class PlainMemberName(
    @Required @EncodeDefault public override val kind: String = "text",
    public val text: String,
) : MemberName {
    init {
        require(kind == "text") { "PlainMemberName: kind is \"text\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class PlainTextPart(
    @Required @EncodeDefault public override val kind: String = "text",
    public val text: String,
) : TextPart {
    init {
        require(kind == "text") { "PlainTextPart: kind is \"text\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class Shape(
    public val body: Template,
    public val headers: List<HeaderTemplate>,
)

/** A slot of the template language (ADR 0002 sections 13 and 14), without its '$'. */
public typealias Slot = String

@Serializable
public data class SlotMemberName(
    @Required @EncodeDefault public override val kind: String = "slot",
    public val slot: Slot,
) : MemberName {
    init {
        require(kind == "slot") { "SlotMemberName: kind is \"slot\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class SlotTemplate(
    @Required @EncodeDefault public override val kind: String = "slot",
    public val slot: Slot,
    public val path: List<String>,
) : Template {
    init {
        require(kind == "slot") { "SlotTemplate: kind is \"slot\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class SlotTextPart(
    @Required @EncodeDefault public override val kind: String = "slot",
    public val slot: Slot,
    public val path: List<String>,
) : TextPart {
    init {
        require(kind == "slot") { "SlotTextPart: kind is \"slot\", got \"" + kind + "\"" }
    }
}

@Serializable
public data class SuccessShapes(
    public val item: Shape,
    public val table: Shape,
    public val list: Shape,
    public val page: Shape,
)

/** A template of the template language (ADR 0002 sections 13 and 14). */
@Serializable(with = TemplateSerializer::class)
public sealed interface Template {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : Template {
        init {
            require(kind !in setOf("slot", "text", "literal", "object", "array", "each")) { "Template.Unknown: \"" + kind + "\" is a known kind" }
            require(raw["kind"] == JsonPrimitive(kind)) { "Template.Unknown: raw's kind is not \"" + kind + "\"" }
        }
    }
}

internal object TemplateSerializer : IrUnionSerializer<Template>("Template", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): Template? = when (tag) {
        "slot" -> json.decodeFromJsonElement(SlotTemplate.serializer(), element)
        "text" -> json.decodeFromJsonElement(TextTemplate.serializer(), element)
        "literal" -> json.decodeFromJsonElement(LiteralTemplate.serializer(), element)
        "object" -> json.decodeFromJsonElement(ObjectTemplate.serializer(), element)
        "array" -> json.decodeFromJsonElement(ArrayTemplate.serializer(), element)
        "each" -> json.decodeFromJsonElement(EachTemplate.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): Template = Template.Unknown(tag, element)

    override fun encode(json: Json, value: Template): JsonElement = when (value) {
        is SlotTemplate -> json.encodeToJsonElement(SlotTemplate.serializer(), value)
        is TextTemplate -> json.encodeToJsonElement(TextTemplate.serializer(), value)
        is LiteralTemplate -> json.encodeToJsonElement(LiteralTemplate.serializer(), value)
        is ObjectTemplate -> json.encodeToJsonElement(ObjectTemplate.serializer(), value)
        is ArrayTemplate -> json.encodeToJsonElement(ArrayTemplate.serializer(), value)
        is EachTemplate -> json.encodeToJsonElement(EachTemplate.serializer(), value)
        is Template.Unknown -> value.raw
    }
}

/** A part of a text template: literal text, or a slot with its path. */
@Serializable(with = TextPartSerializer::class)
public sealed interface TextPart {
    /** The tag member 'kind': it picks the variant. */
    public val kind: String

    /** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
    public data class Unknown(override val kind: String, public val raw: JsonObject) : TextPart {
        init {
            require(kind !in setOf("text", "slot")) { "TextPart.Unknown: \"" + kind + "\" is a known kind" }
            require(raw["kind"] == JsonPrimitive(kind)) { "TextPart.Unknown: raw's kind is not \"" + kind + "\"" }
        }
    }
}

internal object TextPartSerializer : IrUnionSerializer<TextPart>("TextPart", "kind") {
    override fun decodeKnown(json: Json, tag: String, element: JsonObject): TextPart? = when (tag) {
        "text" -> json.decodeFromJsonElement(PlainTextPart.serializer(), element)
        "slot" -> json.decodeFromJsonElement(SlotTextPart.serializer(), element)
        else -> null
    }

    override fun unknown(tag: String, element: JsonObject): TextPart = TextPart.Unknown(tag, element)

    override fun encode(json: Json, value: TextPart): JsonElement = when (value) {
        is PlainTextPart -> json.encodeToJsonElement(PlainTextPart.serializer(), value)
        is SlotTextPart -> json.encodeToJsonElement(SlotTextPart.serializer(), value)
        is TextPart.Unknown -> value.raw
    }
}

@Serializable
public data class TextTemplate(
    @Required @EncodeDefault public override val kind: String = "text",
    public val parts: List<TextPart>,
) : Template {
    init {
        require(kind == "text") { "TextTemplate: kind is \"text\", got \"" + kind + "\"" }
    }
}

@Serializable(with = UrlRoleSerializer::class)
public sealed interface UrlRole {
    public val value: String

    public data object SELF : UrlRole { override val value: String = "self" }
    public data object FIRST : UrlRole { override val value: String = "first" }
    public data object PREVIOUS : UrlRole { override val value: String = "previous" }
    public data object NEXT : UrlRole { override val value: String = "next" }
    public data object LAST : UrlRole { override val value: String = "last" }

    /** A value this IR revision does not know; a known value is always its constant. */
    public data class Unknown(override val value: String) : UrlRole {
        init {
            require(UrlRole.known.none { it.value == value }) { "UrlRole.Unknown: \"" + value + "\" is a known value" }
        }
    }

    public companion object {
        /** The values this IR revision knows, in the schema's order. */
        public val known: List<UrlRole> by lazy { listOf(SELF, FIRST, PREVIOUS, NEXT, LAST) }

        public fun of(value: String): UrlRole = when (value) {
            "self" -> SELF
            "first" -> FIRST
            "previous" -> PREVIOUS
            "next" -> NEXT
            "last" -> LAST
            else -> Unknown(value)
        }
    }
}

internal object UrlRoleSerializer : IrOpenEnumSerializer<UrlRole>("UrlRole", UrlRole::of, UrlRole::value)

/** A wire format (A30, ADR 0008). */
@Serializable
public data class WireFormat(
    public val id: FormatId,
    public val origin: Origin,
    public val media: String,
    public val absent: Absent,
    public val success: SuccessShapes,
    public val meta: Map<String, MetaMember>,
    public val error: ErrorShape,
)
