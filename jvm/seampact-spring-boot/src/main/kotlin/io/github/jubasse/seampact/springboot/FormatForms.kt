package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.Absent
import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.ObjectTemplate
import io.github.jubasse.seampact.ir.model.Operation
import io.github.jubasse.seampact.ir.model.PlainMemberName
import io.github.jubasse.seampact.ir.model.ResponseShape
import io.github.jubasse.seampact.ir.model.Shape
import io.github.jubasse.seampact.ir.model.SlotTemplate
import io.github.jubasse.seampact.ir.model.SuccessShapes
import io.github.jubasse.seampact.ir.model.Template

private const val PAYLOAD_SLOT = "payload"

// The slots an item, table or list envelope may write that the boundary fills; `$meta` stays without a value while
// format meta members are refused.
private val RENDERED_ENVELOPE_SLOTS = setOf(PAYLOAD_SLOT, "status", "path", "meta")

/**
 * The format's success shape of a response with a body (ADR 0002 section 13), as the Node and PHP targets render it:
 * an item, table or list envelope that writes `$payload` under named members, with no format meta member, no success
 * header and no slot beside the payload, the status and the path. A page's body is its paging style's to check.
 */
internal fun checkSuccessFormat(ir: ContractIR, operation: Operation, shape: ResponseShape, refusals: Refusals) {
    val formatAt = IrPlace.ROOT.below("formats", operation.format)
    val format = ir.formats[operation.format]
    if (format == null) {
        refusals.inconsistent("format.undeclared", "The format '${operation.format}' is not declared", formatAt)
        return
    }

    if (format.absent is Absent.Unknown) refusals.unknownValue(formatAt.below("absent"), format.absent.value)
    if (format.meta.isNotEmpty()) refusals.waiting("format.meta", "The meta members of the format '${format.id}'", formatAt.below("meta"), Delivery.AFTER_1_0)

    val successShape = successShapeOf(format.success, shape) ?: return
    val shapeAt = formatAt.below("success", shape.value)
    if (successShape.headers.isNotEmpty()) refusals.waiting("format.success.headers", "A success format header", shapeAt.below("headers"), Delivery.AFTER_1_0)
    if (shape == ResponseShape.PAGE) return

    val bodyAt = shapeAt.below("body")
    val payloadPath = slotPath(successShape.body, PAYLOAD_SLOT)
    if (payloadPath == null) {
        refusals.waiting("format.success.envelope", "A success envelope that does not write `\$payload` under named members", bodyAt, Delivery.AFTER_1_0)
        return
    }

    for (slot in templateSlots(successShape.body).toSortedSet()) {
        if (slot !in RENDERED_ENVELOPE_SLOTS) refusals.waiting("format.success.slot", "The success envelope slot '\$$slot'", bodyAt, Delivery.AFTER_1_0)
    }
}

private fun successShapeOf(success: SuccessShapes, shape: ResponseShape): Shape? = when (shape) {
    ResponseShape.ITEM -> success.item
    ResponseShape.TABLE -> success.table
    ResponseShape.LIST -> success.list
    ResponseShape.PAGE -> success.page
    else -> null
}

// The member names down to [slot], reached through named object members only; null when the template never writes it.
private fun slotPath(template: Template, slot: String): List<String>? {
    if (template is SlotTemplate) return if (template.slot == slot && template.path.isEmpty()) emptyList() else null
    if (template !is ObjectTemplate) return null

    for (member in template.members) {
        val name = member.name as? PlainMemberName ?: continue
        val rest = slotPath(member.value, slot) ?: continue
        return listOf(name.text) + rest
    }

    return null
}
