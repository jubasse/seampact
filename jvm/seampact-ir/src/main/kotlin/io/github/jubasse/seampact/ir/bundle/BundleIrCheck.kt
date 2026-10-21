package io.github.jubasse.seampact.ir.bundle

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.IrJson
import io.github.jubasse.seampact.ir.model.irNumberOf
import io.github.jubasse.seampact.ir.read.IrRefusalCode
import io.github.jubasse.seampact.ir.read.IrSupport
import io.github.jubasse.seampact.ir.read.checkIrSupport
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Step 3 of the pinned-bundle check, for one api: the IR file is UTF-8 JSON with no reserved key, declares the
// irVersion and irRevision the manifest lists, is of a version this reader reads at its exact irRevision (before
// 1.0, ADR 0005), with the lists it reads well-formed, then decodes into the IR model generated from the IR JSON
// Schema, which keeps unknown members, tags and values as the open schema does. Kinds, features and must-act
// unknowns are a target's question (`IrReader.read` with its own support), not the bundle's.

private const val FIX = "Rebuild the bundle with a compiler of this IR revision, or use the seampact release that reads it."

// This reader's version and exact revision; kinds and features are left to the target that reads the IR.
private val READER_SUPPORT = IrSupport.ofModel(kinds = emptyList())

private val SUPPORT_CODES = mapOf(
    IrRefusalCode.VERSION_UNSUPPORTED to BundleFailureCode.IR_VERSION,
    IrRefusalCode.REVISION_MISMATCH to BundleFailureCode.IR_REVISION,
    IrRefusalCode.SUPPORT_MALFORMED to BundleFailureCode.IR_INVALID,
)

internal sealed interface BundleIrCheck {
    data class Read(val document: JsonElement, val ir: ContractIR) : BundleIrCheck

    data class Refused(val failure: BundleFailure) : BundleIrCheck
}

/** The api's IR, or the failure naming its file and the values that differ. */
internal fun checkBundleIr(api: BundleApi, bytes: ByteArray): BundleIrCheck {
    val text = utf8Text(bytes)
    val parsed = if (text == null) UntrustedJson.Refused("is not UTF-8 text") else parseUntrustedJson(text)
    if (parsed is UntrustedJson.Refused) {
        return refused(BundleFailure(BundleFailureCode.IR_UNREADABLE, "'${api.file}' ${parsed.problem}.", FIX, api.file))
    }

    val document = (parsed as UntrustedJson.Parsed).value
    val declaredVersion = (document as? JsonObject)?.get("irVersion")
    val declaredRevision = (document as? JsonObject)?.get("irRevision")
    if (!isNumber(declaredVersion, api.irVersion) || !isNumber(declaredRevision, api.irRevision)) {
        return refused(
            BundleFailure(
                code = BundleFailureCode.IR_DECLARATION,
                message = "'${api.file}' declares irVersion ${shown(declaredVersion)} and irRevision " +
                    "${shown(declaredRevision)}; the manifest lists ${api.irVersion} and ${api.irRevision}.",
                fix = FIX,
                file = api.file,
                expected = "${api.irVersion}.${api.irRevision}",
                actual = "${plain(declaredVersion)}.${plain(declaredRevision)}",
            ),
        )
    }

    val support = supportFailure(api, document)
    if (support != null) return refused(support)

    return decoded(api, document)
}

private fun refused(failure: BundleFailure): BundleIrCheck = BundleIrCheck.Refused(failure)

private fun isNumber(element: JsonElement?, expected: Long): Boolean =
    element is JsonPrimitive && !element.isString && irNumberOf(element.content) == expected.toDouble()

// A declared value in a message, as the compiler's `quote` shows it: a string quoted, a missing one `undefined`.
private fun shown(element: JsonElement?): String = when {
    element == null -> "undefined"
    element is JsonPrimitive && element.isString -> quoted(element.content)
    else -> element.toString()
}

// A declared value as `String(value)` gives it: a string bare.
private fun plain(element: JsonElement?): String = when {
    element == null -> "undefined"
    element is JsonPrimitive -> element.content
    else -> element.toString()
}

private fun supportFailure(api: BundleApi, document: JsonElement): BundleFailure? {
    for (refusal in checkIrSupport(document, READER_SUPPORT)) {
        val code = SUPPORT_CODES[refusal.code] ?: continue
        val expected = refusal.expected.joinToString(", ")

        return BundleFailure(
            code = code,
            message = "'${api.file}' holds ${quoted(refusal.value)} at ${quoted(refusal.member)}; this reader reads $expected.",
            fix = FIX,
            file = api.file,
            expected = expected,
            actual = refusal.value,
        )
    }

    return null
}

private fun decoded(api: BundleApi, document: JsonElement): BundleIrCheck {
    // SerializationException is an IllegalArgumentException; so is the tag check of a variant used alone.
    val ir = try {
        IrJson.decodeFromJsonElement(ContractIR.serializer(), document)
    } catch (error: IllegalArgumentException) {
        return refused(
            BundleFailure(
                BundleFailureCode.IR_INVALID,
                "'${api.file}' is not valid under the IR JSON Schema: ${quoted(error.message.orEmpty())}.",
                FIX,
                api.file,
            ),
        )
    }

    return BundleIrCheck.Read(document, ir)
}
