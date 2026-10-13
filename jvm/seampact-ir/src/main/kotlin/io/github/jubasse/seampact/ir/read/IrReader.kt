package io.github.jubasse.seampact.ir.read

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.IrJson
import kotlinx.serialization.json.JsonElement

/** The IR is one this reader must not act on: every reason, named (ADR 0005 sections 2 and 3). */
public class IrRefusedException(public val refusals: List<IrRefusal>) :
    RuntimeException(refusals.joinToString("\n") { "${it.code.code}: ${it.message}" })

/** The text is not JSON, or its JSON is not an IR of this model's shape. */
public class IrMalformedException(message: String, cause: Throwable) : RuntimeException(message, cause)

/**
 * Reads an IR document into the generated model. Before anything is decoded it checks, in order, `irVersion`
 * and `irRevision` and the declaration kinds and features the reader supports (the codes of `checkIrSupport`),
 * then the unknown tags and values of must-act definitions. Every other unknown member, tag and value is
 * tolerated: members are dropped, tags and values are kept as `Unknown`.
 */
public object IrReader {
    /** @throws IrRefusedException the IR is not one [support] reads or acts on safely
     *  @throws IrMalformedException the text is not JSON or not an IR */
    public fun read(text: String, support: IrSupport): ContractIR = read(parse(text), support)

    /** @see read */
    public fun read(document: JsonElement, support: IrSupport): ContractIR {
        refuseUnlessEmpty(checkIrSupport(document, support))
        refuseUnlessEmpty(checkMustActUnknowns(document))

        // SerializationException is an IllegalArgumentException; so is the tag check of a variant used alone.
        try {
            return IrJson.decodeFromJsonElement(ContractIR.serializer(), document)
        } catch (error: IllegalArgumentException) {
            throw IrMalformedException("The IR does not match the IR model: ${error.message}", error)
        }
    }

    private fun parse(text: String): JsonElement {
        try {
            return IrJson.parseToJsonElement(text)
        } catch (error: IllegalArgumentException) {
            throw IrMalformedException("The IR is not JSON: ${error.message}", error)
        }
    }

    private fun refuseUnlessEmpty(refusals: List<IrRefusal>) {
        if (refusals.isNotEmpty()) throw IrRefusedException(refusals)
    }
}
