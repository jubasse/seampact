package io.github.jubasse.seampact.ir.bundle

import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.name
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Test

// The open IR JSON Schema pass of the pinned-bundle check: every golden IR passes, a schema violation and a
// must-act unknown are listed, and an unknown tag of an open union is accepted, as Ajv's open form does.
class IrSchemaCheckTest {
    private val golden: Path = Path.of(System.getProperty("seampact.repositoryRoot"), "fixtures/golden")
    private val tasks: JsonObject = read(golden.resolve("reference/tasks.ir.json"))

    @Test
    fun everyGoldenIrIsValid() {
        val files = Files.walk(golden).use { paths -> paths.filter { it.name.endsWith(".ir.json") }.toList() }

        assertTrue(files.isNotEmpty())
        for (file in files) assertEquals(emptyList(), irSchemaProblems(read(file)), file.toString())
    }

    @Test
    fun listsAViolationAtItsPointer() {
        val problems = irSchemaProblems(tasks.with("api", tasks.getValue("api").jsonObject.with("id", JsonPrimitive(3))))

        assertEquals(listOf("at '/api/id' 'integer found, string expected'"), problems)
    }

    @Test
    fun acceptsAnUnknownTagOfAnOpenUnionAndRefusesOneOfAMustActUnion() {
        val schemas = tasks.getValue("schemas").jsonObject
        val unknownSchemaKind = schemas.getValue("ApiEmptyBody").jsonObject.with("kind", JsonPrimitive("future"))
        assertEquals(emptyList(), irSchemaProblems(tasks.with("schemas", schemas.with("ApiEmptyBody", unknownSchemaKind))))

        val operations = tasks.getValue("operations").jsonArray
        val first = operations[0].jsonObject
        val futureAccess = first.with("access", first.getValue("access").jsonObject.with("kind", JsonPrimitive("future")))
        val problems = irSchemaProblems(tasks.with("operations", JsonArray(listOf(futureAccess) + operations.drop(1))))
        assertEquals(listOf("at '/operations/0/access/kind' an unknown 'future'"), problems)
    }

    @Test
    fun theMessageListsFiveProblemsThenCountsTheRest() {
        val message = irSchemaMessage("ir/tasks.json", (1..7).map { "p$it" })

        assertEquals("'ir/tasks.json' is not valid under the IR JSON Schema: p1; p2; p3; p4; p5; and 2 more.", message)
    }

    private fun read(file: Path): JsonObject = Json.parseToJsonElement(Files.readString(file)).jsonObject

    private fun JsonObject.with(key: String, value: JsonElement): JsonObject = JsonObject(this + (key to value))
}
