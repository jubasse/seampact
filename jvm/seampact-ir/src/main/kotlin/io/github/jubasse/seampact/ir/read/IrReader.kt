package io.github.jubasse.seampact.ir.read

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.IrJson
import io.github.jubasse.seampact.ir.model.shownLiteral
import kotlinx.serialization.json.JsonElement

// The cause's message can quote untrusted input: the exception's own message keeps this much of it.
private const val MAX_CAUSE_MESSAGE_LENGTH = 400

/** The IR is one this reader must not act on: every reason, named, up to 100 (ADR 0005 sections 2 and 3). */
public class IrRefusedException(public val refusals: List<IrRefusal>) :
    RuntimeException(refusals.joinToString("\n") { "${it.code.code}: ${it.message}" })

/** The text is not JSON, or its JSON is not an IR of this model's shape. */
public class IrMalformedException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

/**
 * Reads an IR document into the generated model. Before anything is parsed or decoded it checks, in order: the
 * nesting depth of the whole document (`ir.nesting.too-deep`, alone, past 256 arrays and objects); for a text,
 * a bare token JSON refuses (`3d`, `NaN`), malformed though the platform parser reads it; `irVersion`
 * and `irRevision` and the declaration kinds and features the reader supports (the codes of `checkIrSupport`);
 * then the unknown tags and values of must-act definitions. Every other unknown member, tag and value is
 * tolerated: members are dropped, tags and values are kept as `Unknown`.
 *
 * The reader bounds its own work and output: nesting depth, at most 100 refusals per check, and every untrusted
 * string cut in a message. A refusal still keeps its pointer and operation id whole, so callers bound the size
 * of the input they read.
 */
public object IrReader {
    /** @throws IrRefusedException the IR is nested too deep, or not one [support] reads or acts on safely
     *  @throws IrMalformedException the text is not JSON or not an IR */
    public fun read(text: String, support: IrSupport): ContractIR {
        val scan = scanText(text)
        refuseIfPresent(scan.nestingRefusal)
        if (scan.nonJsonToken != null) {
            throw IrMalformedException("The IR is not JSON: '${shownLiteral(scan.nonJsonToken)}' is not a JSON value.")
        }

        return readWithinNestingBound(parse(text), support)
    }

    /** @see read */
    public fun read(document: JsonElement, support: IrSupport): ContractIR {
        refuseIfPresent(checkElementNesting(document))

        return readWithinNestingBound(document, support)
    }

    private fun readWithinNestingBound(document: JsonElement, support: IrSupport): ContractIR {
        refuseUnlessEmpty(checkIrSupport(document, support))
        refuseUnlessEmpty(checkMustActUnknowns(document))

        // SerializationException is an IllegalArgumentException; so is the tag check of a variant used alone.
        try {
            return IrJson.decodeFromJsonElement(ContractIR.serializer(), document)
        } catch (error: IllegalArgumentException) {
            throw IrMalformedException("The IR does not match the IR model: ${causeOf(error)}", error)
        }
    }

    private fun parse(text: String): JsonElement {
        try {
            return IrJson.parseToJsonElement(text)
        } catch (error: IllegalArgumentException) {
            throw IrMalformedException("The IR is not JSON: ${causeOf(error)}", error)
        }
    }

    private fun causeOf(error: Throwable): String {
        val message = error.message.orEmpty()
        if (message.length <= MAX_CAUSE_MESSAGE_LENGTH) return message

        return message.take(MAX_CAUSE_MESSAGE_LENGTH) + "..."
    }

    private fun refuseIfPresent(refusal: IrRefusal?) {
        if (refusal != null) throw IrRefusedException(listOf(refusal))
    }

    private fun refuseUnlessEmpty(refusals: List<IrRefusal>) {
        if (refusals.isNotEmpty()) throw IrRefusedException(refusals)
    }
}
