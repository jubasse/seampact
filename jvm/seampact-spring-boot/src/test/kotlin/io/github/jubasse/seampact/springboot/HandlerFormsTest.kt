package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.CredentialIdentity
import io.github.jubasse.seampact.ir.model.HeaderDecl
import io.github.jubasse.seampact.ir.model.HeaderSemantic
import io.github.jubasse.seampact.ir.model.HeaderSide
import io.github.jubasse.seampact.ir.model.HeaderUseFor
import io.github.jubasse.seampact.ir.model.IdentityHeaderUse
import io.github.jubasse.seampact.ir.model.Origin
import io.github.jubasse.seampact.ir.read.IrReader
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// The reference tasksService identity declares request headers, which the handler reads (a warning); an identity
// header the server would write on a response has no value a handler can write, so it is refused by name.
class HandlerFormsTest {
    private val repositoryRoot: Path = Path.of(System.getProperty("seampact.repositoryRoot"))

    private fun tasksServiceIr(): ContractIR =
        IrReader.read(Files.readString(repositoryRoot.resolve("fixtures/golden/reference/tasksService.ir.json")), SpringBootTarget.IR_SUPPORT)

    @Test
    fun refusesAnIdentityHeaderWrittenOnAResponseByNameAtItsDeclaration() {
        val ir = tasksServiceIr()
        val service = ir.identities.getValue("service") as CredentialIdentity
        val rightsVersion = HeaderDecl(
            id = "rightsVersion",
            semantic = HeaderSemantic.VERSION_TOKEN,
            response = "X-Rights-Version",
            request = "If-Rights-Version",
            origin = Origin(layer = "shared", pointer = "/headers/rightsVersion"),
        )
        val rightsVersionUse = IdentityHeaderUse(
            header = "rightsVersion",
            for_ = HeaderUseFor.WRITES,
            required = false,
            origin = Origin(layer = "shared", pointer = "/identities/service/headers/rightsVersion"),
        )
        val changed = ir.copy(
            operations = ir.operations.filter { it.id == "getTask" },
            headers = ir.headers + ("trace" to ir.headers.getValue("trace").copy(in_ = HeaderSide.RESPONSE)) + ("rightsVersion" to rightsVersion),
            identities = ir.identities + ("service" to service.copy(headers = service.headers + rightsVersionUse)),
        )
        val entry = SpringBootEntry(id = "server", options = JsonObject(mapOf("package" to JsonPrimitive("com.acme.tasks"))))

        val refusals = assertFailsWith<SpringBootRefusedException> { SpringBootTarget.generate(changed, entry) }.refusals

        assertEquals(
            listOf("/headers/trace" to "getTask", "/headers/rightsVersion" to "getTask"),
            refusals.map { it.member to it.operation },
        )
        assertTrue(refusals.all { it.code == "identity.response.header.unsupported" }, refusals.toString())
        assertTrue("The response header 'X-Rights-Version' of the identity 'service'" in refusals.last().message, refusals.last().message)
    }

    @Test
    fun anIdentityWithOnlyResponseHeadersDoesNotWarn() {
        val ir = tasksServiceIr()
        val changed = ir.copy(headers = ir.headers.mapValues { (_, declaration) -> declaration.copy(in_ = HeaderSide.RESPONSE) })

        assertEquals(emptyList(), SpringBootTarget.handlerWarnings(changed))
        assertTrue(SpringBootTarget.handlerWarnings(ir).all { it.code == IDENTITY_HEADERS_HANDLER })
    }
}
