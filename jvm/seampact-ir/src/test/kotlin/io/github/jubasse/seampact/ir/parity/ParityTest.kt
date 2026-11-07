package io.github.jubasse.seampact.ir.parity

import io.github.jubasse.seampact.ir.read.IrMalformedException
import io.github.jubasse.seampact.ir.read.IrReader
import io.github.jubasse.seampact.ir.read.IrRefusal
import io.github.jubasse.seampact.ir.read.IrRefusedException
import io.github.jubasse.seampact.ir.read.IrSupport
import io.github.jubasse.seampact.ir.read.scanText
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

private const val ACCEPT = "accept"
private const val MALFORMED = "malformed"
private const val NOT_JSON = "not-json"
private const val REFUSE = "refuse"

private fun literalPlaceholder(index: Int) = "literal-placeholder-$index"

// The reader parity corpus (ADR 0010): for every case of `packages/core/spec/vectors/ir/cases.json` this reader gives
// the verdict of the TypeScript reader, and names the same codes and members. The message text is never compared.
class ParityTest {
    private val root: Path = Path.of(System.getProperty("seampact.repositoryRoot"))

    // The platform parser reads a bare token such as `3d` as a literal: the text is checked against JSON first.
    private fun strictJsonOf(path: Path): JsonElement {
        val text = path.readText()
        val scan = scanText(text)
        check(scan.nestingRefusal == null && scan.nonJsonToken == null) { "$path is not JSON: ${scan.nonJsonToken}" }

        return Json.parseToJsonElement(text)
    }

    private val corpus: JsonObject = strictJsonOf(root.resolve("packages/core/spec/vectors/ir/cases.json")).jsonObject

    private fun supportNamed(name: String): IrSupport {
        val declared = corpus.getValue("supports").jsonObject.getValue(name).jsonObject

        return IrSupport(
            irVersions = declared.getValue("irVersions").jsonArray.map { it.jsonPrimitive.long },
            irRevision = declared.getValue("irRevision").jsonPrimitive.long,
            kinds = declared.getValue("kinds").jsonArray.map { it.jsonPrimitive.content },
            features = declared.getValue("features").jsonArray.map { it.jsonPrimitive.content },
        )
    }

    private fun segmentsOf(pointer: String): List<String> =
        pointer.split("/").drop(1).map { it.replace("~1", "/").replace("~0", "~") }

    // The element with [value] at [segments], or without that member when [value] is null.
    private fun edited(element: JsonElement, segments: List<String>, value: JsonElement?): JsonElement {
        val head = segments.first()
        val rest = segments.drop(1)

        if (element is JsonArray) {
            val position = head.toInt()
            if (rest.isEmpty()) return JsonArray(element.mapIndexedNotNull { index, item -> if (index == position) value else item })

            return JsonArray(element.mapIndexed { index, item -> if (index == position) edited(item, rest, value) else item })
        }

        val members = element.jsonObject
        if (rest.isEmpty()) {
            check(value != null || head in members) { "nothing to remove at $head" }

            return JsonObject(if (value == null) members - head else members + (head to value))
        }

        return JsonObject(members + (head to edited(members.getValue(head), rest, value)))
    }

    private fun documentTextOf(case: JsonObject): String {
        val example = case.getValue("example").jsonPrimitive.content
        var document: JsonElement = strictJsonOf(root.resolve("packages/core/spec/schemas/ir/examples/$example"))

        for (edit in case["edits"]?.jsonArray.orEmpty()) {
            val fields = edit.jsonObject
            val value = if ("remove" in fields) null else fields.getValue("value")

            document = edited(document, segmentsOf(fields.getValue("pointer").jsonPrimitive.content), value)
        }

        val literals = case["literals"]?.jsonArray.orEmpty().map { it.jsonObject }

        literals.forEachIndexed { index, literal ->
            val pointer = segmentsOf(literal.getValue("pointer").jsonPrimitive.content)

            document = edited(document, pointer, JsonPrimitive(literalPlaceholder(index)))
        }

        var text = document.toString()

        literals.forEachIndexed { index, literal ->
            text = text.replace("\"${literalPlaceholder(index)}\"", literal.getValue("text").jsonPrimitive.content)
        }

        return text
    }

    /** The outcome of reading [text], with its refusals sorted as the corpus sorts them. */
    private fun verdictOf(text: String, support: IrSupport): Pair<String, List<IrRefusal>> {
        try {
            IrReader.read(text, support)
        } catch (refused: IrRefusedException) {
            return REFUSE to refused.refusals.sortedWith(compareBy({ it.member }, { it.code.code }))
        } catch (malformed: IrMalformedException) {
            return MALFORMED to emptyList()
        }

        return ACCEPT to emptyList()
    }

    private fun JsonObject.text(member: String): String? = get(member)?.jsonPrimitive?.content

    // Each field the corpus records; a support refusal, the one with an expected list, has its operation compared too.
    private fun refusalAgrees(expected: JsonObject, actual: IrRefusal): Boolean {
        val expectedList = expected["expected"]?.jsonArray?.map { it.jsonPrimitive.content }

        return expected.text("code") == actual.code.code &&
            expected.text("member") == actual.member &&
            (expected.text("value") ?: actual.value) == actual.value &&
            (expectedList ?: actual.expected) == actual.expected &&
            (expectedList == null || expected.text("operation") == actual.operation)
    }

    // Text that is not JSON is malformed for every reader.
    private fun agrees(expected: JsonObject, actual: Pair<String, List<IrRefusal>>): Boolean {
        val outcome = expected.text("outcome")
        if (outcome == NOT_JSON) return actual.first == MALFORMED

        val expectedRefusals = expected["refusals"]?.jsonArray.orEmpty().map { it.jsonObject }

        return outcome == actual.first &&
            expectedRefusals.size == actual.second.size &&
            expectedRefusals.zip(actual.second).all { (want, got) -> refusalAgrees(want, got) }
    }

    @Test
    fun matchesTypeScriptVerdicts() {
        val cases = corpus.getValue("cases").jsonArray.map { it.jsonObject }

        assertTrue(cases.size > 50)

        val mismatches = cases.mapNotNull { case ->
            val id = case.getValue("id").jsonPrimitive.content
            val verdict = case.getValue("verdict").jsonObject
            val actual = verdictOf(documentTextOf(case), supportNamed(case.getValue("support").jsonPrimitive.content))

            if (agrees(verdict, actual)) null else "$id: expected $verdict, got $actual"
        }

        assertEquals(emptyList(), mismatches)
    }

    @Test
    fun theCorpusIsBuiltForThisRevision() {
        val revision = corpus.getValue("irRevision").jsonPrimitive.long

        assertEquals(io.github.jubasse.seampact.ir.model.IrModelVersion.IR_REVISION, revision)
    }
}
