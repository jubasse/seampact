package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.ObjectSchema
import io.github.jubasse.seampact.ir.read.IrReader
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// A member both optional and nullable reaches the handler as a Field<T>, so absent and an explicit null stay apart; the
// boundary mapper's reading of a Field is BoundaryMapperTest's (seampact-spring-runtime).
class AbsentVersusNullTest {
    private val repositoryRoot: Path = Path.of(System.getProperty("seampact.repositoryRoot"))

    private fun updateTaskIrWithNullableTitle(): ContractIR {
        val ir = IrReader.read(Files.readString(repositoryRoot.resolve("fixtures/golden/reference/tasks.ir.json")), SpringBootTarget.IR_SUPPORT)
        val updateTask = ir.schemas.getValue("UpdateTask") as ObjectSchema
        val nullableTitle = updateTask.copy(properties = updateTask.properties.map { if (it.name == "title") it.copy(nullable = true) else it })

        return ir.copy(operations = ir.operations.filter { it.id == "updateTask" }, schemas = ir.schemas + ("UpdateTask" to nullableTitle))
    }

    private fun generatedUpdateTaskRecord(): String {
        val entry = SpringBootEntry(id = "server", options = JsonObject(mapOf("package" to JsonPrimitive("com.acme.tasks"))))

        return SpringBootTarget.generate(updateTaskIrWithNullableTitle(), entry).single { it.path.endsWith("/schemas/UpdateTask.java") }.contents
    }

    @Test
    fun anOptionalAndNullableMemberIsAFieldOfItsValueType() {
        val record = generatedUpdateTaskRecord()

        assertTrue("Field<String> title" in record, record)
        assertTrue("import io.github.jubasse.seampact.hooks.Field;" in record, record)
    }

    @Test
    fun anOptionalMemberThatIsNotNullableStaysAnOptional() {
        val record = generatedUpdateTaskRecord()

        assertTrue("Optional<TaskState> state" in record, record)
    }
}
