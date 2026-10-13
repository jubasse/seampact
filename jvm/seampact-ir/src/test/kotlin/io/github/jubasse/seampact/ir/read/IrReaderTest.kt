package io.github.jubasse.seampact.ir.read

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.IrJson
import io.github.jubasse.seampact.ir.model.IrModelVersion
import io.github.jubasse.seampact.ir.model.Maturity
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

// The reader against the IR examples: the checks run on the raw document before decoding, with the codes of
// `checkIrSupport`, and a valid document reads and writes back unchanged up to the unknown members it drops.
class IrReaderTest {
    private val examples: Path =
        Path.of(System.getProperty("seampact.repositoryRoot"), "packages/spec/schemas/ir/examples")

    private val support = IrSupport.ofModel(kinds = listOf("httpOperation"))

    private fun exampleText(name: String): String = examples.resolve(name).readText()

    private fun example(name: String): JsonObject = IrJson.parseToJsonElement(exampleText(name)).jsonObject

    private fun write(contract: ContractIR): JsonElement = IrJson.encodeToJsonElement(ContractIR.serializer(), contract)

    private fun refusals(document: JsonElement, readerSupport: IrSupport = support): List<IrRefusal> =
        assertFailsWith<IrRefusedException> { IrReader.read(document, readerSupport) }.refusals

    private fun replaceAt(document: JsonObject, vararg path: String, value: JsonElement): JsonObject {
        if (path.size == 1) return JsonObject(document + (path.single() to value))
        val child = document.getValue(path.first())
        val inner = if (child is JsonArray) {
            JsonArray(child.mapIndexed { index, item -> if (index == path[1].toInt()) replaceAt(item.jsonObject, *path.drop(2).toTypedArray(), value = value) else item })
        } else {
            replaceAt(child.jsonObject, *path.drop(1).toTypedArray(), value = value)
        }
        return JsonObject(document + (path.first() to inner))
    }

    @Test
    fun readsExamples() {
        for (name in listOf("minimal.ir.json", "every-member.ir.json", "unknown-enum-value.ir.json")) {
            val contract = IrReader.read(exampleText(name), support)

            assertEquals(example(name), write(contract), name)
        }
        assertIs<Maturity.Unknown>(IrReader.read(exampleText("unknown-enum-value.ir.json"), support).api.maturity)
        IrReader.read(exampleText("unknown-member.ir.json"), support)
        IrReader.read(exampleText("unknown-kind.ir.json"), support)
    }

    @Test
    fun emptyObjectsRoundTrip() {
        val written = write(IrReader.read(exampleText("minimal.ir.json"), support)).jsonObject
        val api = written.getValue("api").jsonObject

        assertEquals(JsonObject(emptyMap()), api.getValue("extensions"))
        assertEquals(JsonObject(emptyMap()), api.getValue("docs"))
        assertEquals(JsonObject(emptyMap()), written.getValue("schemas"))
    }

    @Test
    fun refusesOtherRevision() {
        val document = replaceAt(example("minimal.ir.json"), "irRevision", value = JsonPrimitive(IrModelVersion.IR_REVISION + 6))

        val refusal = refusals(document).single()

        assertEquals(IrRefusalCode.REVISION_MISMATCH, refusal.code)
        assertEquals("/irRevision", refusal.member)
        assertEquals("8", refusal.value)
        assertEquals(listOf("2"), refusal.expected)
        assertTrue("io.github.jubasse:seampact-ir" in refusal.message, refusal.message)
        assertTrue("(2)" in refusal.message && "irRevision 8" in refusal.message, refusal.message)
    }

    @Test
    fun refusesOtherVersion() {
        // The rest of the document has another shape: nothing but the version is read, and it is named alone.
        val document = JsonObject(mapOf("irVersion" to JsonPrimitive(2), "irRevision" to JsonPrimitive(9), "kinds" to JsonPrimitive("x")))

        val refusal = refusals(document).single()

        assertEquals(IrRefusalCode.VERSION_UNSUPPORTED, refusal.code)
        assertEquals("/irVersion", refusal.member)
        assertEquals("2", refusal.value)
        assertEquals(listOf("1"), refusal.expected)
        assertTrue("io.github.jubasse:seampact-ir" in refusal.message, refusal.message)
        assertEquals(IrRefusalCode.VERSION_UNSUPPORTED, refusals(JsonPrimitive("not an IR")).single().code)
        assertEquals("missing", refusals(JsonObject(emptyMap())).single().value)
    }

    @Test
    fun refusesUnknownKind() {
        val refused = refusals(example("unknown-kind-and-feature.ir.json"))
        val kind = refused.single { it.code == IrRefusalCode.KIND_UNSUPPORTED }

        assertEquals("/kinds/1", kind.member)
        assertEquals("channel", kind.value)
        assertEquals(listOf("httpOperation"), kind.expected)
        assertEquals("The declaration kind 'channel' is not supported by this reader.", kind.message)

        val operationKind = replaceAt(example("every-member.ir.json"), "operations", "1", "kind", value = JsonPrimitive("channel"))
        val refusal = refusals(operationKind).single()
        assertEquals("/operations/1/kind", refusal.member)
        assertEquals("health", refusal.operation)
    }

    @Test
    fun refusesUnknownFeature() {
        val refused = refusals(example("unknown-kind-and-feature.ir.json"))
        val features = refused.filter { it.code == IrRefusalCode.FEATURE_UNSUPPORTED }

        assertEquals(listOf("/features/0", "/operations/0/features/0"), features.map { it.member })
        assertEquals(listOf(null, "health"), features.map { it.operation })
        assertEquals("The feature 'streaming' in operation 'health' is not supported by this reader.", features[1].message)
        assertEquals(
            listOf(IrRefusalCode.KIND_UNSUPPORTED, IrRefusalCode.FEATURE_UNSUPPORTED, IrRefusalCode.FEATURE_UNSUPPORTED),
            refused.map { it.code },
        )

        val declared = IrSupport.ofModel(kinds = listOf("httpOperation", "channel"), features = listOf("streaming"))
        IrReader.read(exampleText("unknown-kind-and-feature.ir.json"), declared)

        val malformed = replaceAt(example("minimal.ir.json"), "features", value = JsonPrimitive("streaming"))
        assertEquals(IrRefusalCode.SUPPORT_MALFORMED, refusals(malformed).single().code)
        assertEquals("string", refusals(malformed).single().value)
    }

    @Test
    fun refusesUnknownMustAct() {
        val schemeKind = refusals(example("unknown-must-act.ir.json")).single()

        assertEquals(IrRefusalCode.MUST_ACT_UNKNOWN, schemeKind.code)
        assertEquals("/schemes/client/kind", schemeKind.member)
        assertEquals("mtls", schemeKind.value)
        assertEquals(null, schemeKind.operation)

        val inOperation = replaceAt(example("every-member.ir.json"), "operations", "0", "access", "onRefused", value = JsonPrimitive("redirect"))
        val unknownValue = refusals(inOperation).single()
        assertEquals("/operations/0/access/onRefused", unknownValue.member)
        assertEquals("redirect", unknownValue.value)
        assertEquals("getTask", unknownValue.operation)
        assertEquals(listOf("anonymous", "reject"), unknownValue.expected)

        // A must-act union nested in an operation names the operation too.
        val unionInOperation = replaceAt(example("every-member.ir.json"), "operations", "0", "access", "kind", value = JsonPrimitive("vault"))
        assertEquals("/operations/0/access/kind", refusals(unionInOperation).single().member)
    }

    @Test
    fun unknownThatIsNotMustActIsKept() {
        // A refusal needs a must-act definition: an unknown schema kind and an unknown maturity are only kept.
        IrReader.read(exampleText("unknown-kind.ir.json"), support)
        IrReader.read(exampleText("unknown-enum-value.ir.json"), support)
    }

    @Test
    fun malformedDocumentsAreNamed() {
        assertFailsWith<IrMalformedException> { IrReader.read("{", support) }
        val missingApi = JsonObject(example("minimal.ir.json") - "api")
        assertFailsWith<IrMalformedException> { IrReader.read(missingApi, support) }
        val untaggedScheme = replaceAt(example("minimal.ir.json"), "schemes", "client", value = JsonObject(mapOf("id" to JsonPrimitive("client"))))
        assertFailsWith<IrMalformedException> { IrReader.read(untaggedScheme, support) }
    }
}
