package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.QueryWireKind
import io.github.jubasse.seampact.ir.read.IrReader
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// The runtime reads a query value under its declared name, so a list sent in brackets form (`tag[]=a`, CHK-160)
// is refused by name at generation rather than read as an undeclared key.
class SpringBootQueryListRefusalsTest {
    private val repositoryRoot: Path = Path.of(System.getProperty("seampact.repositoryRoot"))

    @Test
    fun refusesAQueryListInBracketsForm() {
        val text = Files.readString(repositoryRoot.resolve("fixtures/golden/reference/tasks.ir.json"))
        val ir = IrReader.read(text, SpringBootTarget.IR_SUPPORT)
        val listTasks = ir.operations.single { it.id == "listTasks" }
        val query = listTasks.params.query.map { param ->
            val wire = param.wire
            if (wire?.kind == QueryWireKind.LIST) param.copy(wire = wire.copy(explode = true, brackets = true)) else param
        }
        check(query != listTasks.params.query) { "the golden listTasks has no list query param" }
        val bracketed = ir.copy(operations = listOf(listTasks.copy(params = listTasks.params.copy(query = query))))
        val entry = SpringBootEntry(id = "server", options = JsonObject(mapOf("package" to JsonPrimitive("com.acme.tasks"))))

        val refusals = assertFailsWith<SpringBootRefusedException> { SpringBootTarget.generate(bracketed, entry) }.refusals

        assertTrue(refusals.any { it.code == "query.list.brackets.unsupported" && it.operation == "listTasks" })
    }
}
