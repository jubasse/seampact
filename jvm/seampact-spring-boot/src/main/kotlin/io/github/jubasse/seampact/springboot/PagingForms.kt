package io.github.jubasse.seampact.springboot

import com.palantir.javapoet.ParameterizedTypeName
import com.palantir.javapoet.TypeName
import com.palantir.javapoet.TypeSpec
import io.github.jubasse.seampact.ir.model.ArrayTemplate
import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.EachTemplate
import io.github.jubasse.seampact.ir.model.HandlerResultMember
import io.github.jubasse.seampact.ir.model.LiteralTemplate
import io.github.jubasse.seampact.ir.model.ObjectSchema
import io.github.jubasse.seampact.ir.model.ObjectTemplate
import io.github.jubasse.seampact.ir.model.Operation
import io.github.jubasse.seampact.ir.model.PagingParamPlacement
import io.github.jubasse.seampact.ir.model.PagingPosition
import io.github.jubasse.seampact.ir.model.PagingRole
import io.github.jubasse.seampact.ir.model.PagingStyle
import io.github.jubasse.seampact.ir.model.RefTypeUse
import io.github.jubasse.seampact.ir.model.ResponseShape
import io.github.jubasse.seampact.ir.model.SlotMemberName
import io.github.jubasse.seampact.ir.model.SlotTemplate
import io.github.jubasse.seampact.ir.model.SlotTextPart
import io.github.jubasse.seampact.ir.model.Template
import io.github.jubasse.seampact.ir.model.TextTemplate
import io.github.jubasse.seampact.ir.model.UrlRole
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

// The slots a page template may write that the boundary fills: the response roles, the request path and status, and
// the format's `$meta` (ADR 0002 section 14). `resource` and `collection` are not rendered yet, as on the Node targets.
private val RENDERED_PAGE_SLOTS = setOf(
    "items", "nextCursor", "previousCursor", "more", "page", "offset", "limit", "from", "to", "total", "totalPages",
    "self", "first", "previous", "next", "last", "nextSince", "complete", "path", "status", "meta",
)

// The page slots whose value is an array or an object, never a header value.
private val STRUCTURED_PAGE_SLOTS = setOf("items", "meta")
private const val PAGE_SLOT = "page"
private const val ITEMS_MEMBER = "items"
private const val SPRING_PAGE_STYLE = "springPage"
private const val SPRING_PACK_LAYER = "pack:@seampact/pack-spring"

/** The input component a `springPage` list's handler reads its Spring Data `Pageable` from. */
internal const val PAGEABLE_COMPONENT = "pageable"

/**
 * Whether [operation] is a list paged by the `springPage` style of `@seampact/pack-spring`, whose handler takes a
 * Spring Data `Pageable` and returns a `Page` (ADR 0022 "Paging"); every other style keeps the generated page record.
 */
internal fun isSpringPageList(ir: ContractIR, operation: Operation): Boolean {
    val style = operation.paging?.style?.let { ir.pagings[it] } ?: return false

    return style.id == SPRING_PAGE_STYLE && style.origin.layer == SPRING_PACK_LAYER
}

/** Whether any kept operation of the api is a `springPage` list, so the Spring Data bridge is generated. */
internal fun usesSpringPages(layout: JavaLayout): Boolean = layout.kept.operations.any { (_, operation) -> isSpringPageList(layout.ir, operation) }

/**
 * The Java member each sort key of a `springPage` list names, the property Spring Data sorts the entity by: the item's
 * member of that wire name, else the member a property of that name would take. Null for a key that yields no Java
 * name, which `checkPaging` refuses.
 */
internal fun springSortProperties(ir: ContractIR, operation: Operation): Map<String, String?> {
    val item = operation.responses.firstOrNull { it.shape == ResponseShape.PAGE }?.body as? RefTypeUse
    val itemSchema = item?.let { ir.schemas[it.schema] } as? ObjectSchema

    return operation.paging?.sortKeys.orEmpty().associate { sortKey ->
        val property = itemSchema?.properties?.firstOrNull { it.name == sortKey.key }

        sortKey.key to memberIdentifier(sortKey.key, property?.codeName)
    }
}

/**
 * The paging forms of one list (ADR 0022 "Query and bounded values"): the style resolves, its request roles are read
 * from the query, and every slot its templates write is one the boundary fills; anything else is refused by name.
 */
internal fun checkPaging(ir: ContractIR, operation: Operation, at: IrPlace, refusals: Refusals) {
    val paging = operation.paging ?: return
    checkRestrictedSortKeys(operation, at, refusals)

    val styleId = paging.style ?: return
    val style = ir.pagings[styleId]
    if (style == null) {
        refusals.inconsistent("paging.style.unresolved", "The paging style '$styleId' is not declared", at.below("paging", "style"))
        return
    }

    val styleAt = IrPlace.ROOT.below("pagings", styleId)
    if (style.position is PagingPosition.Unknown) refusals.unknownValue(styleAt.below("position"), style.position.value)
    if ((style.position == PagingPosition.PAGE || style.position == PagingPosition.OFFSET) && paging.defaultLimit == null) {
        refusals.inconsistent("paging.defaultLimit.missing", "The ${style.position.value} list has no default limit", at.below("paging"))
    }

    style.request.forEachIndexed { index, role ->
        val roleAt = styleAt.below("request", index)
        if (role.role is PagingRole.Unknown) refusals.unknownValue(roleAt.below("role"), role.role.value)
        if (role.in_ != PagingParamPlacement.QUERY) {
            refusals.waiting("paging.request.in", "A paging '${role.role.value}' role in '${role.in_.value}'", roleAt.below("in"), Delivery.AFTER_1_0)
        }
    }

    style.handlerResult.forEachIndexed { index, member ->
        if (member is HandlerResultMember.Unknown) refusals.unknownValue(styleAt.below("handlerResult", index), member.value)
    }
    style.response.links.forEachIndexed { index, link ->
        if (link.role is UrlRole.Unknown) refusals.unknownValue(styleAt.below("response", "links", index, "role"), link.role.value)
    }

    checkPageTemplates(ir, operation, style, styleAt, refusals)
    if (isSpringPageList(ir, operation)) checkSpringSortKeys(ir, operation, at, refusals)
}

// A sort key a right restricts: the boundary does not ask that right yet (ADR 0012 step 7), as on the PHP targets.
private fun checkRestrictedSortKeys(operation: Operation, at: IrPlace, refusals: Refusals) {
    operation.paging?.sortKeys.orEmpty().forEachIndexed { index, sortKey ->
        val right = sortKey.right ?: return@forEachIndexed
        refusals.waiting(
            "paging.sortKey.right",
            "The sort key '${sortKey.key}' restricted by the right '$right'",
            at.below("paging", "sortKeys", index, "right"),
            Delivery.CONSUMER,
        )
    }
}

private fun checkSpringSortKeys(ir: ContractIR, operation: Operation, at: IrPlace, refusals: Refusals) {
    val members = springSortProperties(ir, operation)
    operation.paging?.sortKeys.orEmpty().forEachIndexed { index, sortKey ->
        if (members[sortKey.key] == null) {
            refusals.inconsistent("paging.sortKey.no-member", "The sort key '${sortKey.key}' yields no Java member name", at.below("paging", "sortKeys", index, "key"))
        }
    }
}

private fun checkPageTemplates(ir: ContractIR, operation: Operation, style: PagingStyle, styleAt: IrPlace, refusals: Refusals) {
    val responseAt = styleAt.below("response")
    val body = style.response.body
    if (body != null) {
        checkSlots(style, body, responseAt.below("body"), refusals)
    } else {
        ir.formats[operation.format]?.let { checkSlots(style, it.success.page.body, IrPlace.ROOT.below("formats", operation.format, "success", "page", "body"), refusals) }
    }

    style.response.meta.forEachIndexed { index, member -> checkSlots(style, member.value, responseAt.below("meta", index, "value"), refusals) }
    style.response.headers.forEachIndexed { index, header ->
        val headerAt = responseAt.below("headers", index, "value")
        checkSlots(style, header.value, headerAt, refusals)
        if (!isScalarTemplate(header.value)) {
            refusals.waiting(
                "paging.response.header",
                "The header '${header.name}' of the paging style '${style.id}', written from an object or an array,",
                headerAt,
                Delivery.AFTER_1_0,
            )
        }
    }
}

// An offset kind has no page number of its own: its base is not declared.
private fun checkSlots(style: PagingStyle, template: Template, at: IrPlace, refusals: Refusals) {
    val unrendered = templateSlots(template).toSortedSet().filter { slot ->
        slot !in RENDERED_PAGE_SLOTS || (slot == PAGE_SLOT && style.position == PagingPosition.OFFSET)
    }
    if (unrendered.isEmpty()) return

    refusals.waiting(
        "paging.response.slot",
        "The page slots ${unrendered.joinToString(", ") { "'$$it'" }} of the paging style '${style.id}'",
        at,
        Delivery.AFTER_1_0,
    )
}

/** The slot names a template writes, at any depth. */
internal fun templateSlots(template: Template): List<String> = when (template) {
    is SlotTemplate -> listOf(template.slot)
    is EachTemplate -> listOf(template.of) + templateSlots(template.as_)
    is ObjectTemplate -> template.members.flatMap { member -> listOfNotNull((member.name as? SlotMemberName)?.slot) + templateSlots(member.value) }
    is ArrayTemplate -> template.items.flatMap(::templateSlots)
    is TextTemplate -> template.parts.filterIsInstance<SlotTextPart>().map { it.slot }
    else -> emptyList()
}

private fun isScalarTemplate(template: Template): Boolean = when (template) {
    is TextTemplate -> true
    is LiteralTemplate -> template.value !is JsonObject && template.value !is JsonArray
    is SlotTemplate -> template.path.isNotEmpty() || template.slot !in STRUCTURED_PAGE_SLOTS
    else -> false
}

/**
 * The page a paged list's handler returns (ADR 0002 section 14): its items, and the members its style asks for beside
 * them; the cursors are optional, since they are absent at either end of the list.
 */
internal fun pageRecord(layout: JavaLayout, operation: Operation, itemType: TypeName): TypeSpec? {
    if (isSpringPageList(layout.ir, operation)) return null
    val style = operation.paging?.style?.let { layout.ir.pagings[it] } ?: return null
    val components = mutableListOf(RecordComponent(ITEMS_MEMBER, ParameterizedTypeName.get(JavaTypes.LIST, itemType)))

    for (member in style.handlerResult) {
        val type = when (member) {
            HandlerResultMember.NEXT_CURSOR, HandlerResultMember.PREVIOUS_CURSOR -> ParameterizedTypeName.get(JavaTypes.OPTIONAL, JavaTypes.STRING)
            HandlerResultMember.TOTAL -> TypeName.LONG
            HandlerResultMember.MORE, HandlerResultMember.COMPLETE -> TypeName.BOOLEAN
            HandlerResultMember.NEXT_SINCE -> JavaTypes.STRING
            is HandlerResultMember.Unknown -> continue
        }
        components += RecordComponent(member.value, type)
    }

    return generatedRecord(layout.operation(operation.id).page, components, layout).build()
}
