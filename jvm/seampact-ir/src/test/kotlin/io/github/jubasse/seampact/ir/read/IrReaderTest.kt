@file:OptIn(ExperimentalSerializationApi::class)

package io.github.jubasse.seampact.ir.read

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.IrJson
import io.github.jubasse.seampact.ir.model.IrModelVersion
import io.github.jubasse.seampact.ir.model.Maturity
import io.github.jubasse.seampact.ir.model.Schema
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonUnquotedLiteral
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

    private fun write(contract: ContractIR): JsonElement =
        IrJson.encodeToJsonElement(ContractIR.serializer(), contract)

    private fun refusals(document: JsonElement, readerSupport: IrSupport = support): List<IrRefusal> =
        assertFailsWith<IrRefusedException> { IrReader.read(document, readerSupport) }.refusals

    private fun replaceAt(document: JsonObject, vararg path: String, value: JsonElement): JsonObject {
        if (path.size == 1) return JsonObject(document + (path.single() to value))

        val child = document.getValue(path.first())
        val inner = if (child is JsonArray) {
            val position = path[1].toInt()
            val below = path.drop(2).toTypedArray()
            JsonArray(
                child.mapIndexed { index, item ->
                    if (index == position) replaceAt(item.jsonObject, *below, value = value) else item
                },
            )
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
    }

    @Test
    fun dropsUnknownMembersOnly() {
        val input = example("unknown-member.ir.json")
        val api = input.getValue("api").jsonObject
        val origin = api.getValue("origin").jsonObject
        val withoutUnknown = JsonObject(
            (input - "generatedBy") + ("api" to JsonObject((api - "owner") + ("origin" to JsonObject(origin - "column")))),
        )

        assertEquals(withoutUnknown, write(IrReader.read(exampleText("unknown-member.ir.json"), support)))
    }

    @Test
    fun keepsUnknownSchemaKindRaw() {
        val input = example("unknown-kind.ir.json")

        val written = write(IrReader.read(exampleText("unknown-kind.ir.json"), support)).jsonObject

        assertEquals(input.getValue("schemas"), written.getValue("schemas"))
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
        val otherRevision = JsonPrimitive(IrModelVersion.IR_REVISION + 6)
        val document = replaceAt(example("minimal.ir.json"), "irRevision", value = otherRevision)

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
        val document = JsonObject(
            mapOf("irVersion" to JsonPrimitive(2), "irRevision" to JsonPrimitive(9), "kinds" to JsonPrimitive("x")),
        )

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

        val operationKind =
            replaceAt(example("every-member.ir.json"), "operations", "1", "kind", value = JsonPrimitive("channel"))
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
        assertEquals(
            "The feature 'streaming' in operation 'health' is not supported by this reader.",
            features[1].message,
        )
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

        val inOperation = replaceAt(
            example("every-member.ir.json"),
            "operations", "0", "access", "onRefused",
            value = JsonPrimitive("redirect"),
        )
        val unknownValue = refusals(inOperation).single()
        assertEquals("/operations/0/access/onRefused", unknownValue.member)
        assertEquals("redirect", unknownValue.value)
        assertEquals("getTask", unknownValue.operation)
        assertEquals(listOf("anonymous", "reject"), unknownValue.expected)

        // A must-act union nested in an operation names the operation too.
        val unionInOperation = replaceAt(
            example("every-member.ir.json"),
            "operations", "0", "access", "kind",
            value = JsonPrimitive("vault"),
        )
        assertEquals("/operations/0/access/kind", refusals(unionInOperation).single().member)
    }

    @Test
    fun unknownThatIsNotMustActIsKept() {
        // A refusal needs a must-act definition: an unknown schema kind and an unknown maturity are only kept.
        val point = IrReader.read(exampleText("unknown-kind.ir.json"), support).schemas.values.single()
        assertIs<Schema.Unknown>(point)
        assertEquals("tuple", point.kind)

        val maturity = IrReader.read(exampleText("unknown-enum-value.ir.json"), support).api.maturity
        assertIs<Maturity.Unknown>(maturity)
        assertEquals(
            example("unknown-enum-value.ir.json").getValue("api").jsonObject.getValue("maturity"),
            JsonPrimitive(maturity.value),
        )
    }

    @Test
    fun hugeExponentVersionAndRevisionAreRefusedWithABoundedValue() {
        val huge = JsonUnquotedLiteral("1e2147483647")

        val version = refusals(replaceAt(example("minimal.ir.json"), "irVersion", value = huge)).single()
        assertEquals(IrRefusalCode.VERSION_UNSUPPORTED, version.code)
        assertEquals("1e2147483647", version.value)

        val revision = refusals(replaceAt(example("minimal.ir.json"), "irRevision", value = huge)).single()
        assertEquals(IrRefusalCode.REVISION_MISMATCH, revision.code)
        assertEquals("1e2147483647", revision.value)
        assertTrue(revision.message.length < 400, revision.message)

        val parsed = IrJson.parseToJsonElement("""{"irVersion": 1e2147483647}""")
        assertEquals(IrRefusalCode.VERSION_UNSUPPORTED, refusals(parsed).single().code)
    }

    @Test
    fun aLongUntrustedValueIsCutInTheMessageOnly() {
        val tag = "x".repeat(100_000)
        val document = replaceAt(example("unknown-must-act.ir.json"), "schemes", "client", "kind", value = JsonPrimitive(tag))

        val refusal = refusals(document).single()

        assertEquals(tag, refusal.value)
        assertTrue(refusal.message.length < 600, "message is ${refusal.message.length} chars")
    }

    @Test
    fun refusesNestingPastTheDepthBound() {
        var nested: JsonElement = JsonObject(mapOf("kind" to JsonPrimitive("scalar")))
        repeat(20_000) { nested = JsonObject(mapOf("kind" to JsonPrimitive("array"), "items" to nested)) }
        val deepMap = JsonObject(mapOf("kind" to JsonPrimitive("map"), "values" to nested))
        val document = replaceAt(example("minimal.ir.json"), "schemas", value = JsonObject(mapOf("Deep" to deepMap)))

        val refusal = refusals(document).single()

        assertEquals(IrRefusalCode.NESTING_TOO_DEEP, refusal.code)
        assertTrue(refusal.member.startsWith("/schemas/Deep/values/items"), refusal.member)
    }

    @Test
    fun malformedDocumentsAreNamed() {
        assertFailsWith<IrMalformedException> { IrReader.read("{", support) }
        val missingApi = JsonObject(example("minimal.ir.json") - "api")
        assertFailsWith<IrMalformedException> { IrReader.read(missingApi, support) }
        val untaggedScheme = replaceAt(
            example("minimal.ir.json"),
            "schemes", "client",
            value = JsonObject(mapOf("id" to JsonPrimitive("client"))),
        )
        assertFailsWith<IrMalformedException> { IrReader.read(untaggedScheme, support) }
    }
}
