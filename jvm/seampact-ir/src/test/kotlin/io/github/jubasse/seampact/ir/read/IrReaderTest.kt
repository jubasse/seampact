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

// The JVM's default thread stack: a test that overflows it overflows a default reader thread.
private const val SMALL_STACK_BYTES = 1L shl 20

private const val DEEP_PLACEHOLDER = "deep-placeholder"

// A refusal message with every untrusted string cut, and an exception message with its cause cut. The longest
// refusal message quotes three cut strings (value, pointer, operation id, 83 chars each) in about 150 chars of
// text: 600 leaves room for that and still fails on any uncut string of the 100,000 the tests use.
private const val REFUSAL_MESSAGE_BOUND = 600
private const val EXCEPTION_MESSAGE_BOUND = 1_000

// A linear walk of the 10 MB document takes about 0.1 s; the quadratic one took about 9 s.
private const val WALK_BUDGET_MILLIS = 3_000L

/** A deeply nested value, as JSON text and as the same elements, built without recursion. */
private class Deep(val text: String, val element: JsonElement)

private fun nestedArrays(levels: Int): Deep {
    var element: JsonElement = JsonPrimitive(0)
    repeat(levels) { element = JsonArray(listOf(element)) }
    return Deep("[".repeat(levels) + "0" + "]".repeat(levels), element)
}

private fun nestedObjects(levels: Int): Deep {
    var element: JsonElement = JsonPrimitive(0)
    repeat(levels) { element = JsonObject(mapOf("a" to element)) }
    return Deep("{\"a\":".repeat(levels) + "0" + "}".repeat(levels), element)
}

// Array type uses nested [levels] deep around a string scalar, whose refinements are one level more.
private fun arrayTypeUses(levels: Int): Deep {
    val scalar = """{"kind":"scalar","type":"string","refinements":{}}"""
    var element: JsonElement = IrJson.parseToJsonElement(scalar)
    repeat(levels) { element = JsonObject(mapOf("kind" to JsonPrimitive("array"), "items" to element)) }
    return Deep("""{"kind":"array","items":""".repeat(levels) + scalar + "}".repeat(levels), element)
}

// Runs [block] on a thread with a 1 MB stack and rethrows whatever it threw, a StackOverflowError included.
private fun <T> onSmallStack(block: () -> T): T {
    var outcome: Result<T>? = null
    val thread = Thread(null, { outcome = runCatching(block) }, "small-stack", SMALL_STACK_BYTES)
    thread.start()
    thread.join()
    return checkNotNull(outcome).getOrThrow()
}

// The reader against the IR examples: the checks run on the raw document before decoding, with the codes of
// `checkIrSupport`, and a valid document reads and writes back unchanged up to the unknown members it drops.
class IrReaderTest {
    private val examples: Path =
        Path.of(System.getProperty("seampact.repositoryRoot"), "packages/core/spec/schemas/ir/examples")

    private val support = IrSupport.ofModel(kinds = listOf("httpOperation"))

    private fun exampleText(name: String): String = examples.resolve(name).readText()

    private fun example(name: String): JsonObject = IrJson.parseToJsonElement(exampleText(name)).jsonObject

    private fun write(contract: ContractIR): JsonElement =
        IrJson.encodeToJsonElement(ContractIR.serializer(), contract)

    private fun refusals(document: JsonElement, readerSupport: IrSupport = support): List<IrRefusal> =
        assertFailsWith<IrRefusedException> { IrReader.read(document, readerSupport) }.refusals

    private fun refusals(text: String): List<IrRefusal> =
        assertFailsWith<IrRefusedException> { IrReader.read(text, support) }.refusals

    // The document with [deep] at [path], as text and as elements.
    private fun bothWays(base: JsonObject, vararg path: String, deep: Deep): List<() -> ContractIR> {
        val placeholder = replaceAt(base, *path, value = JsonPrimitive(DEEP_PLACEHOLDER))
        val text = placeholder.toString().replace("\"$DEEP_PLACEHOLDER\"", deep.text)
        val document = replaceAt(base, *path, value = deep.element)

        return listOf({ IrReader.read(text, support) }, { IrReader.read(document, support) })
    }

    private fun readBothWays(base: JsonObject, vararg path: String, deep: Deep) {
        for (read in bothWays(base, *path, deep = deep)) onSmallStack(read)
    }

    // The single nesting refusal, the same from the text and from the elements.
    private fun nestingRefusal(base: JsonObject, vararg path: String, deep: Deep): IrRefusal {
        val refusals = bothWays(base, *path, deep = deep).map { read ->
            assertFailsWith<IrRefusedException> { onSmallStack(read) }.refusals.single()
        }

        assertEquals(IrRefusalCode.NESTING_TOO_DEEP, refusals[0].code)
        assertEquals(refusals[0], refusals[1])
        return refusals[0]
    }

    private fun replaceAt(document: JsonObject, vararg path: String, value: JsonElement): JsonObject {
        if (path.size == 1) return JsonObject(document + (path.single() to value))

        val child = document.getValue(path.first())
        val inner = if (child is JsonArray) {
            val position = path[1].toInt()
            val below = path.drop(2).toTypedArray()
            JsonArray(
                child.mapIndexed { index, item ->
                    when {
                        index != position -> item
                        below.isEmpty() -> value
                        else -> replaceAt(item.jsonObject, *below, value = value)
                    }
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
        val apiWithoutUnknown = JsonObject((api - "owner") + ("origin" to JsonObject(origin - "column")))
        val withoutUnknown = JsonObject((input - "generatedBy") + ("api" to apiWithoutUnknown))

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
        val revision = IrModelVersion.IR_REVISION.toString()
        val otherRevision = (IrModelVersion.IR_REVISION + 6).toString()
        val document = replaceAt(example("minimal.ir.json"), "irRevision", value = JsonPrimitive(otherRevision.toLong()))

        val refusal = refusals(document).single()

        assertEquals(IrRefusalCode.REVISION_MISMATCH, refusal.code)
        assertEquals("/irRevision", refusal.member)
        assertEquals(otherRevision, refusal.value)
        assertEquals(listOf(revision), refusal.expected)
        assertTrue("io.github.jubasse:seampact-ir" in refusal.message, refusal.message)
        assertTrue("($revision)" in refusal.message && "irRevision $otherRevision" in refusal.message, refusal.message)
    }

    @Test
    fun readsVersionLiteralsAsJavaScriptDoes() {
        // Read as the rounded double, as the TypeScript and PHP readers read them: no length cap either.
        val text = exampleText("minimal.ir.json")
            .replace("\"irVersion\": 1,", "\"irVersion\": 1.${"0".repeat(70)},")
            .replace("\"irRevision\": ${IrModelVersion.IR_REVISION},", "\"irRevision\": ${IrModelVersion.IR_REVISION}.0000000000000000001,")

        assertEquals(IrModelVersion.IR_REVISION, IrReader.read(text, support).irRevision)
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
            listOf(
                IrRefusalCode.KIND_UNSUPPORTED,
                IrRefusalCode.FEATURE_UNSUPPORTED,
                IrRefusalCode.FEATURE_UNSUPPORTED,
            ),
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
        assertTrue(revision.message.length < REFUSAL_MESSAGE_BOUND, revision.message)

        val parsed = IrJson.parseToJsonElement("""{"irVersion": 1e2147483647}""")
        assertEquals(IrRefusalCode.VERSION_UNSUPPORTED, refusals(parsed).single().code)
    }

    @Test
    fun aLongUntrustedValueIsCutInTheMessageOnly() {
        val tag = "x".repeat(100_000)
        val document =
            replaceAt(example("unknown-must-act.ir.json"), "schemes", "client", "kind", value = JsonPrimitive(tag))

        val refusal = refusals(document).single()

        assertEquals(tag, refusal.value)
        assertTrue(refusal.message.length < REFUSAL_MESSAGE_BOUND, "message is ${refusal.message.length} chars")
    }

    @Test
    fun aLongOperationIdIsCutInEveryMessage() {
        val id = "o".repeat(100_000)
        val features = JsonArray(List(1_000) { JsonPrimitive("feature$it") })
        val withId = replaceAt(example("every-member.ir.json"), "operations", "0", "id", value = JsonPrimitive(id))
        val unsupported = replaceAt(
            replaceAt(withId, "operations", "0", "features", value = features),
            "operations", "0", "kind",
            value = JsonPrimitive("channel"),
        )

        val refused = assertFailsWith<IrRefusedException> { IrReader.read(unsupported, support) }

        assertTrue(refused.refusals.all { it.operation == id })
        val longestMessage = refused.refusals.maxOf { it.message.length }
        assertTrue(longestMessage < REFUSAL_MESSAGE_BOUND, "longest message is $longestMessage chars")
        val total = refused.message.orEmpty().length
        assertTrue(total < MAX_REFUSALS * REFUSAL_MESSAGE_BOUND, "message is $total chars")

        val mustAct = replaceAt(withId, "operations", "0", "access", "onRefused", value = JsonPrimitive("redirect"))
        val refusal = refusals(mustAct).single()
        assertEquals(id, refusal.operation)
        assertTrue(refusal.message.length < REFUSAL_MESSAGE_BOUND, "message is ${refusal.message.length} chars")
    }

    @Test
    fun refusalsStopAtTheBound() {
        // A long key repeats in the pointer of every refusal below it: the count bounds that copy.
        val features = JsonArray(List(1_000) { JsonPrimitive("feature$it") })
        val unsupported = replaceAt(example("minimal.ir.json"), "features", value = features)

        val unsupportedFeatures = refusals(unsupported)
        assertEquals(100, unsupportedFeatures.size)
        assertEquals("/features/99", unsupportedFeatures.last().member)

        val mustAct = example("unknown-must-act.ir.json")
        val scheme = mustAct.getValue("schemes").jsonObject.getValue("client")
        val schemes = JsonObject((0 until 1_000).associate { "client$it" to scheme })
        val unknowns = refusals(replaceAt(mustAct, "schemes", value = schemes))
        assertEquals(100, unknowns.size)
        assertTrue(unknowns.all { it.code == IrRefusalCode.MUST_ACT_UNKNOWN })
    }

    @Test
    fun aLongMapKeyKeepsTheMustActWalkLinear() {
        // The walk once copied the pointer for every node it visited: 400,000 chars times 40,000 properties.
        val everyMember = example("every-member.ir.json")
        val task = everyMember.getValue("schemas").jsonObject.getValue("Task").jsonObject
        val property = task.getValue("properties").jsonArray.first()
        val schema = JsonObject(task + ("properties" to JsonArray(List(40_000) { property })))
        val document = replaceAt(everyMember, "schemas", value = JsonObject(mapOf("k".repeat(400_000) to schema)))

        val started = System.nanoTime()
        val refusals = checkMustActUnknowns(document)
        val elapsedMillis = (System.nanoTime() - started) / 1_000_000

        assertEquals(emptyList(), refusals)
        assertTrue(elapsedMillis < WALK_BUDGET_MILLIS, "the walk took $elapsedMillis ms")
    }

    @Test
    fun deepNestingIsRefusedBeforeAnyRecursion() {
        // Each of these overflowed a 1 MB stack before the bound: the version shown, the array parser, the
        // integer serializer's message.
        val places = listOf(
            listOf("irVersion") to nestedObjects(800),
            listOf("kinds", "0") to nestedObjects(800),
            listOf("x") to nestedArrays(2_000),
            listOf("api", "version", "number") to nestedObjects(3_000),
        )

        val pathVersion = JsonObject(mapOf("kind" to JsonPrimitive("path"), "number" to JsonPrimitive(1)))
        val withPathVersion = replaceAt(example("minimal.ir.json"), "api", "version", value = pathVersion)
        val base = replaceAt(withPathVersion, "kinds", value = JsonArray(listOf(JsonPrimitive("httpOperation"))))

        for ((path, deep) in places) {
            val refusal = nestingRefusal(base, *path.toTypedArray(), deep = deep)

            assertTrue(refusal.member.startsWith("/" + path.joinToString("/")), refusal.member)
        }
    }

    @Test
    fun exactlyTheBoundIsRead() {
        // Known members: an array type use chain in a map schema's values, its scalar's refinements one level more.
        // The root object is level 1, so the first array type use is level 4.
        val everyMember = example("every-member.ir.json")
        readBothWays(everyMember, "schemas", "Labels", "values", deep = arrayTypeUses(251))
        val known = nestingRefusal(everyMember, "schemas", "Labels", "values", deep = arrayTypeUses(252))
        assertEquals("/schemas/Labels/values" + "/items".repeat(252) + "/refinements", known.member)
        assertEquals("257", known.value)
        assertEquals(listOf("256"), known.expected)
        assertEquals(null, known.operation)

        readBothWays(example("minimal.ir.json"), "x", deep = nestedArrays(255))
        val unknownMember = nestingRefusal(example("minimal.ir.json"), "x", deep = nestedArrays(256))
        assertEquals("/x" + "/0".repeat(255), unknownMember.member)

        val unknownKindDocument = example("unknown-kind.ir.json")
        readBothWays(unknownKindDocument, "schemas", "Point", "items", deep = nestedArrays(253))
        val unknownKind = nestingRefusal(unknownKindDocument, "schemas", "Point", "items", deep = nestedArrays(254))
        assertEquals("/schemas/Point/items" + "/0".repeat(253), unknownKind.member)
    }

    @Test
    fun aDocumentTooDeepGetsOneRefusal() {
        val siblings = 10_000
        val crossing = JsonArray(List(siblings) { JsonArray(listOf(JsonPrimitive(0))) })
        var element: JsonElement = crossing
        repeat(254) { element = JsonArray(listOf(element)) }
        val text = "[".repeat(255) + List(siblings) { "[0]" }.joinToString(",") + "]".repeat(255)

        val refusal = nestingRefusal(example("minimal.ir.json"), "x", deep = Deep(text, element))

        assertEquals("/x" + "/0".repeat(255), refusal.member)
    }

    @Test
    fun theTextScanReadsStringsAndKeysAsTheParserDoes() {
        // Brackets inside strings are not levels; a key's escapes are decoded, then escaped for the pointer.
        val deep = nestedArrays(256)
        val text = """{"s":"[[{\"[{\\","k\u00e9\"/~":${deep.text}}"""
        val element = JsonObject(mapOf("s" to JsonPrimitive("[[{\"[{\\"), "ké\"/~" to deep.element))

        val fromText = onSmallStack { refusals(text) }.single()
        val fromElement = onSmallStack { refusals(element) }.single()

        assertEquals("/ké\"~1~0" + "/0".repeat(255), fromText.member)
        assertEquals(fromText, fromElement)

        // Only four hex digits make a \u escape: the parser rejects `\u+041`, so the pointer keeps it as written.
        val signed = onSmallStack { refusals("""{"k\u+041":${deep.text}}""") }.single()
        assertEquals("/ku+041" + "/0".repeat(255), signed.member)
    }

    @Test
    fun aContainerIsShownByItsTypeOnly() {
        val long = "x".repeat(100_000)
        val container = JsonObject(mapOf("a" to JsonArray(listOf(JsonPrimitive(long)))))

        val version = refusals(replaceAt(example("minimal.ir.json"), "irVersion", value = container)).single()
        assertEquals("object", version.value)
        assertTrue(version.message.length < REFUSAL_MESSAGE_BOUND, version.message)

        val kinds = JsonArray(listOf(JsonArray(listOf(JsonPrimitive(long))), JsonPrimitive("httpOperation")))
        val kind = refusals(replaceAt(example("minimal.ir.json"), "kinds", value = kinds)).single()
        assertEquals("array", kind.value)
        assertTrue(kind.message.length < REFUSAL_MESSAGE_BOUND, kind.message)

        val pathVersion = JsonObject(mapOf("kind" to JsonPrimitive("path"), "number" to container))
        val number = replaceAt(example("minimal.ir.json"), "api", "version", value = pathVersion)
        val malformed = assertFailsWith<IrMalformedException> { IrReader.read(number, support) }
        assertTrue("object" in malformed.message.orEmpty(), malformed.message)
        val malformedLength = malformed.message.orEmpty().length
        assertTrue(malformedLength < EXCEPTION_MESSAGE_BOUND, "message is $malformedLength chars")

        val id = replaceAt(example("minimal.ir.json"), "api", "id", value = container)
        val modelError = assertFailsWith<IrMalformedException> { IrReader.read(id, support) }
        val modelErrorLength = modelError.message.orEmpty().length
        assertTrue(modelErrorLength < EXCEPTION_MESSAGE_BOUND, "message is $modelErrorLength chars")
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
