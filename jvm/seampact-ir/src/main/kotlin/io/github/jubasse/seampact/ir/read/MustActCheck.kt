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
 * not must-act is left to the model (it keeps it as `Unknown`). Maps and opaque values are data, never walked,
 * and a union with an unknown tag is not descended into. Never throws on a malformed document: a shape the
 * schema refuses is skipped, and the decoding that follows reports it.
 */
internal fun checkMustActUnknowns(ir: JsonElement): List<IrRefusal> {
    val refusals = mutableListOf<IrRefusal>()
    MustActWalk(ir, refusals).walk(ir, IrShape.Named(ROOT_DEFINITION), "", 0)
    return refusals
}

private const val ROOT_DEFINITION = "ContractIR"

// Levels of JSON nesting the walk descends, and the decode after it: past this the IR is refused, because the
// recursion would overflow the stack. The deepest real IR is a few dozen levels.
private const val MAX_NESTING_DEPTH = 256

private class MustActWalk(private val document: JsonElement, private val refusals: MutableList<IrRefusal>) {
    // The depth counts JSON levels (a struct member, an array item, a map value), not shape nodes.
    fun walk(value: JsonElement, shape: IrShape, pointer: String, depth: Int) {
        if (depth > MAX_NESTING_DEPTH) {
            refuseNesting(pointer)
            return
        }

        when (shape) {
            is IrShape.Named -> IR_SHAPES[shape.definition]?.let { walk(value, it, pointer, depth) }
            is IrShape.Struct -> walkStruct(value, shape, pointer, depth)
            is IrShape.Union -> walkUnion(value, shape, pointer, depth)
            is IrShape.OpenEnum -> walkOpenEnum(value, shape, pointer)
            is IrShape.Items -> (value as? JsonArray)?.forEachIndexed { index, item ->
                walk(item, shape.of, "$pointer/$index", depth + 1)
            }
            is IrShape.Values -> (value as? JsonObject)?.forEach { (key, item) ->
                walk(item, shape.of, "$pointer/${escape(key)}", depth + 1)
            }
        }
    }

    private fun walkStruct(value: JsonElement, shape: IrShape.Struct, pointer: String, depth: Int) {
        val members = value as? JsonObject ?: return
        for ((name, child) in members) {
            val memberShape = shape.members[name] ?: continue
            walk(child, memberShape, "$pointer/${escape(name)}", depth + 1)
        }
    }

    private fun walkUnion(value: JsonElement, shape: IrShape.Union, pointer: String, depth: Int) {
        val union = value as? JsonObject ?: return
        val tag = stringOf(union[shape.tag]) ?: return
        val variant = shape.variants[tag]
        if (variant != null) {
            walk(union, IrShape.Named(variant), pointer, depth)
            return
        }
        if (shape.mustAct) refuse("$pointer/${shape.tag}", tag, shape.variants.keys.toList(), "tag")
    }

    private fun walkOpenEnum(value: JsonElement, shape: IrShape.OpenEnum, pointer: String) {
        val text = stringOf(value) ?: return
        if (shape.mustAct && text !in shape.known) refuse(pointer, text, shape.known.toList(), "value")
    }

    private fun refuseNesting(member: String) {
        refusals += IrRefusal(
            IrRefusalCode.NESTING_TOO_DEEP,
            member,
            MAX_NESTING_DEPTH.toString(),
            emptyList(),
            operationAt(member),
            "The IR is nested more than $MAX_NESTING_DEPTH levels deep at ${inMessage(member)}: " +
                "this reader refuses it rather than overflow its stack.",
        )
    }

    private fun refuse(member: String, value: String, expected: List<String>, what: String) {
        val operation = operationAt(member)
        val where = if (operation == null) "" else " in operation '$operation'"
        refusals += IrRefusal(
            IrRefusalCode.MUST_ACT_UNKNOWN,
            member,
            value,
            expected,
            operation,
            "The $what '${inMessage(value)}' at ${inMessage(member)}$where is unknown to this reader and guards a security boundary: " +
                "a reader that skipped it would apply a weaker check, so it refuses the IR.",
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

private fun escape(member: String): String = member.replace("~", "~0").replace("/", "~1")
