package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.Operation
import io.github.jubasse.seampact.ir.model.ResponseShape
import io.github.jubasse.seampact.ir.read.IrReader
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// The response forms 1.0 refuses by name (CHK-022, 024, 027, 153): a response header the route writes itself, a
// union, a degradable operation and a redirect response fail at generation with the form's code.
class SpringBootResponseFormsRefusalsTest {
    private val repositoryRoot: Path = Path.of(System.getProperty("seampact.repositoryRoot"))

    private fun goldenIr(path: String): ContractIR =
        IrReader.read(Files.readString(repositoryRoot.resolve("fixtures/golden/$path")), SpringBootTarget.IR_SUPPORT)

    private fun tasksIrWith(operationId: String, change: (Operation) -> Operation): ContractIR {
        val ir = goldenIr("reference/tasks.ir.json")

        return ir.copy(operations = ir.operations.filter { it.id == operationId }.map(change))
    }

    private fun refusedCodes(ir: ContractIR): List<String> {
        val entry = SpringBootEntry(id = "server", options = JsonObject(mapOf("package" to JsonPrimitive("com.acme.tasks"))))

        return assertFailsWith<SpringBootRefusedException> { SpringBootTarget.generate(ir, entry) }.refusals.map { it.code }
    }

    @Test
    fun refusesAResponseHeaderTheRouteWrites() {
        val derivedHeader = goldenIr("reference/tasks.ir.json").operations.flatMap { it.responses }.flatMap { it.headers }.first()
        val ir = tasksIrWith("getTask") { operation ->
            val routeHeader = derivedHeader.copy(name = "X-Route-Note", semantic = null, derivedFrom = null)
            val answered = operation.responses.first().let { it.copy(headers = it.headers + routeHeader) }

            operation.copy(responses = listOf(answered) + operation.responses.drop(1))
        }

        assertTrue("response.header.unsupported" in refusedCodes(ir))
    }

    @Test
    fun refusesAUnion() {
        assertTrue("schema.union.unsupported" in refusedCodes(goldenIr("extensions/studio.ir.json")))
    }

    @Test
    fun refusesADegradableOperation() {
        assertTrue("degradable.unsupported" in refusedCodes(goldenIr("extensions/studio.ir.json")))
    }

    @Test
    fun refusesARedirectResponse() {
        val ir = tasksIrWith("getTask") { operation ->
            val redirect = operation.responses.first().copy(shape = ResponseShape.REDIRECT, media = null, body = null)

            operation.copy(responses = listOf(redirect) + operation.responses.drop(1))
        }

        assertTrue("response.shape.unsupported" in refusedCodes(ir))
    }
}
