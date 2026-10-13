package io.github.jubasse.seampact.ir.read

import io.github.jubasse.seampact.ir.model.IR_SHAPES
import io.github.jubasse.seampact.ir.model.IrShape
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private val OPERATION_POINTER = Regex("^/operations/(\\d+)(/|$)")

/**
 * Returns one refusal per unknown tag or value of a must-act union or open enum (ADR 0005 section 3), found by
 * walking the raw document with the generated shapes: the same walk as `listIrUnknowns`, so an unknown that is
 * not must-act is left to the model (it keeps it as `Unknown`). Array items and map values are walked; unknown
 * members and opaque values are data, never walked, and a union with an unknown tag is not descended into. Never
 * throws on a malformed document: a shape the schema refuses is skipped, and the decoding that follows reports
 * it. Stops after [MAX_REFUSALS]. The walk recurses per level: `IrReader` bounds the nesting of the whole
 * document first.
 */
internal fun checkMustActUnknowns(ir: JsonElement): List<IrRefusal> {
    val refusals = mutableListOf<IrRefusal>()
    MustActWalk(ir, refusals).walk(ir, IrShape.Named(ROOT_DEFINITION), null)
    return refusals
}

private const val ROOT_DEFINITION = "ContractIR"

// A pointer as a link to its parent: a step costs one node, and the string is built only for a refusal, so a long
// key is not copied for every node below it. The root document is `null`.
private class PointerStep(val parent: PointerStep?, val segment: String)

private fun pointerOf(step: PointerStep?): String {
    val segments = generateSequence(step) { it.parent }.map { escapePointerSegment(it.segment) }.toList()

    return segments.asReversed().joinToString("") { "/$it" }
}

private class MustActWalk(private val document: JsonElement, private val refusals: MutableList<IrRefusal>) {
    fun walk(value: JsonElement, shape: IrShape, pointer: PointerStep?) {
        if (refusals.size >= MAX_REFUSALS) return

        when (shape) {
            is IrShape.Named -> IR_SHAPES[shape.definition]?.let { walk(value, it, pointer) }
            is IrShape.Struct -> walkStruct(value, shape, pointer)
            is IrShape.Union -> walkUnion(value, shape, pointer)
            is IrShape.OpenEnum -> walkOpenEnum(value, shape, pointer)
            is IrShape.Items -> (value as? JsonArray)?.forEachIndexed { index, item ->
                walk(item, shape.of, PointerStep(pointer, index.toString()))
            }
            is IrShape.Values -> (value as? JsonObject)?.forEach { (key, item) ->
                walk(item, shape.of, PointerStep(pointer, key))
            }
        }
    }

    private fun walkStruct(value: JsonElement, shape: IrShape.Struct, pointer: PointerStep?) {
        val members = value as? JsonObject ?: return
        for ((name, child) in members) {
            val memberShape = shape.members[name] ?: continue
            walk(child, memberShape, PointerStep(pointer, name))
        }
    }

    private fun walkUnion(value: JsonElement, shape: IrShape.Union, pointer: PointerStep?) {
        val union = value as? JsonObject ?: return
        val tag = stringOf(union[shape.tag]) ?: return
        val variant = shape.variants[tag]
        if (variant != null) {
            walk(union, IrShape.Named(variant), pointer)
            return
        }
        if (shape.mustAct) refuse(PointerStep(pointer, shape.tag), tag, shape.variants.keys.toList(), "tag")
    }

    private fun walkOpenEnum(value: JsonElement, shape: IrShape.OpenEnum, pointer: PointerStep?) {
        val text = stringOf(value) ?: return
        if (shape.mustAct && text !in shape.known) refuse(pointer, text, shape.known.toList(), "value")
    }

    private fun refuse(pointer: PointerStep?, value: String, expected: List<String>, what: String) {
        val member = pointerOf(pointer)
        val operation = operationAt(member)
        val where = if (operation == null) "" else " in operation '${inMessage(operation)}'"
        refusals += IrRefusal(
            IrRefusalCode.MUST_ACT_UNKNOWN,
            member,
            value,
            expected,
            operation,
            "The $what '${inMessage(value)}' at ${inMessage(member)}$where is unknown to this reader and guards " +
                "a security boundary: a reader that skipped it would apply a weaker check, so it refuses the IR.",
        )
    }

    private fun operationAt(pointer: String): String? {
        val index = OPERATION_POINTER.find(pointer)?.groupValues?.get(1)?.toIntOrNull() ?: return null
        val operations = (document as? JsonObject)?.get("operations") as? JsonArray
        val operation = operations?.getOrNull(index) as? JsonObject
        return stringOf(operation?.get("id")) ?: "#$index"
    }
}

private fun stringOf(value: JsonElement?): String? = (value as? JsonPrimitive)?.takeIf { it.isString }?.content
