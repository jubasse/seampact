package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.InputMediaType
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

// The body forms 1.0 refuses by name (CHK-150, 151, 152): a form or multipart body and a file download fail at
// generation with the form's code.
class SpringBootBodyFormsRefusalsTest {
    private val repositoryRoot: Path = Path.of(System.getProperty("seampact.repositoryRoot"))

    private fun tasksIrWith(operationId: String, change: (Operation) -> Operation): ContractIR {
        val text = Files.readString(repositoryRoot.resolve("fixtures/golden/reference/tasks.ir.json"))
        val ir = IrReader.read(text, SpringBootTarget.IR_SUPPORT)

        return ir.copy(operations = ir.operations.filter { it.id == operationId }.map(change))
    }

    private fun refusedCodes(ir: ContractIR): List<String> {
        val entry = SpringBootEntry(id = "server", options = JsonObject(mapOf("package" to JsonPrimitive("com.acme.tasks"))))

        return assertFailsWith<SpringBootRefusedException> { SpringBootTarget.generate(ir, entry) }.refusals.map { it.code }
    }

    private fun createTaskSentAs(media: InputMediaType): ContractIR = tasksIrWith("createTask") { operation ->
        val input = checkNotNull(operation.input) { "the golden createTask has no body" }

        operation.copy(input = input.copy(media = media))
    }

    @Test
    fun refusesAFormBody() {
        assertTrue("input.media.unsupported" in refusedCodes(createTaskSentAs(InputMediaType.APPLICATION_X_WWW_FORM_URLENCODED)))
    }

    @Test
    fun refusesAMultipartBody() {
        assertTrue("input.media.unsupported" in refusedCodes(createTaskSentAs(InputMediaType.MULTIPART_FORM_DATA)))
    }

    @Test
    fun refusesAFileDownload() {
        val ir = tasksIrWith("getTask") { operation ->
            val download = operation.responses.first().copy(shape = ResponseShape.BINARY, media = "application/pdf", body = null)

            operation.copy(responses = listOf(download) + operation.responses.drop(1))
        }

        assertTrue("response.shape.unsupported" in refusedCodes(ir))
    }
}
