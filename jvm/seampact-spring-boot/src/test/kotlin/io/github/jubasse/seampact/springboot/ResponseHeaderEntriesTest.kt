package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.DeclarationKind
import io.github.jubasse.seampact.ir.model.Deprecation
import io.github.jubasse.seampact.ir.model.DerivedFrom
import io.github.jubasse.seampact.ir.model.Operation
import io.github.jubasse.seampact.ir.model.OperationRef
import io.github.jubasse.seampact.ir.model.Origin
import io.github.jubasse.seampact.ir.model.ResponseHeader
import io.github.jubasse.seampact.ir.model.ResponseHeaderSemantic
import io.github.jubasse.seampact.ir.model.ValueSource
import io.github.jubasse.seampact.ir.model.ValueSourceIn
import io.github.jubasse.seampact.ir.read.IrReader
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// The response headers the contract table lists for the boundary (ADR 0004 section 7): a deprecated read's dates and
// successor link, and the ETag of a read whose resource the api's If-Match writes version (grammar section 6).
class ResponseHeaderEntriesTest {
    private val repositoryRoot: Path = Path.of(System.getProperty("seampact.repositoryRoot"))
    private val reference: ContractIR =
        IrReader.read(Files.readString(repositoryRoot.resolve("fixtures/golden/reference/tasks.ir.json")), SpringBootTarget.IR_SUPPORT)
    private val updateTask = reference.operations.single { it.id == "updateTask" }
    private val getTask = reference.operations.single { it.id == "getTask" }
    private val taskResource: Origin = updateTask.concurrency!!.derivedFrom.from.first()
    private val entry = SpringBootEntry(id = "server", options = JsonObject(mapOf("package" to JsonPrimitive("com.acme.tasks"))))

    private val deprecationOrigin = Origin(layer = "api", pointer = "/surfaces/app/routes/channels/member/routes/tasks/routes/get/deprecated")

    private fun header(name: String, semantic: ResponseHeaderSemantic? = null, derivedFrom: DerivedFrom = DerivedFrom("deprecation.headers", listOf(deprecationOrigin))) =
        ResponseHeader(name = name, type = getTask.params.path.first().type, required = true, semantic = semantic, derivedFrom = derivedFrom)

    // getTask deprecated in favour of [successor], its 200 carrying the deprecation headers and the resource's ETag.
    private fun deprecatedRead(successor: OperationRef): Operation {
        val headers = listOf(
            header("Deprecation", ResponseHeaderSemantic.DEPRECATION),
            header("Sunset", ResponseHeaderSemantic.SUNSET),
            header("Link", ResponseHeaderSemantic.SUCCESSOR_LINK),
            header("ETag", derivedFrom = DerivedFrom("concurrency.version", listOf(taskResource))),
        )
        val deprecated = Deprecation(
            since = "2026-12-31",
            sunset = "2027-06-30",
            successor = successor,
            successorRel = "successor-version",
            origin = deprecationOrigin,
        )

        return getTask.copy(deprecated = deprecated, responses = getTask.responses.map { it.copy(headers = it.headers + headers) })
    }

    private fun successorOf(api: String) = OperationRef(DeclarationKind.HTTP_OPERATION, api, "updateTask")

    private val ifMatchWrite = updateTask.copy(concurrency = updateTask.concurrency!!.copy(version = ValueSource(ValueSourceIn.HEADER, "If-Match")))

    private fun refusalCodes(vararg operations: Operation): List<String> =
        assertFailsWith<SpringBootRefusedException> { SpringBootTarget.generate(reference.copy(operations = operations.toList()), entry) }
            .refusals.filter { it.operation == "getTask" }.map { it.code }

    @Test
    fun aDeprecatedReadListsItsDatesItsSuccessorAndTheVersionFieldOfItsIfMatchWrites() {
        val read = deprecatedRead(successorOf(reference.api.id))
        val ir = reference.copy(operations = listOf(read, ifMatchWrite))
        val refusals = Refusals()
        val entries = ResponseHeaderEntries(ir, refusals)

        entries.read(read, read.responses.first(), IrPlace.ROOT)

        assertTrue(refusals.isEmpty)
        val expected = Json.parseToJsonElement(
            """
            {"getTask": {"200": [
              {"kind": "text", "name": "Deprecation", "value": "@1798675200"},
              {"kind": "text", "name": "Sunset", "value": "Wed, 30 Jun 2027 00:00:00 GMT"},
              {"kind": "successorLink", "name": "Link", "path": "${updateTask.path}", "rel": "successor-version"},
              {"kind": "entityTag", "name": "ETag", "field": "version"}]}}
            """,
        )
        assertEquals(expected, entries.toJson())
    }

    @Test
    fun anEtagWhoseResourceNoIfMatchWriteOfTheApiVersionsIsRefusedByName() {
        val codes = refusalCodes(deprecatedRead(successorOf(reference.api.id)), updateTask)

        assertTrue("concurrency.etag.withoutWrite.unsupported" in codes, codes.toString())
    }

    @Test
    fun aSuccessorOfAnotherApiIsRefusedByName() {
        val codes = refusalCodes(deprecatedRead(successorOf("billing")), ifMatchWrite)

        assertTrue("deprecated.successor.otherApi.unsupported" in codes, codes.toString())
    }
}
