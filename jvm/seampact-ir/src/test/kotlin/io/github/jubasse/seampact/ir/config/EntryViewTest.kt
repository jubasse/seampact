package io.github.jubasse.seampact.ir.config

import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

// An entry's view of the reference contract's IR (`fixtures/golden/reference`), the operation lists the Node CLI's
// `filterOperations` keeps for the same entries, and the refusals it gives.
class EntryViewTest {
    private val golden: Path = Path.of(System.getProperty("seampact.repositoryRoot"), "fixtures/golden/reference")
    private val tasks = SourceApi("contract", "tasks", irOf("tasks"))
    private val service = SourceApi("contract", "tasksService", irOf("tasksService"))

    @Test
    fun keepsEveryOperationWithoutASelection() {
        assertEquals(operationIds(tasks.ir), viewedIds(entry()))
    }

    @Test
    fun appliesTheDocumentThenIncludeThenExclude() {
        val public = viewedIds(entry(""""document": "public""""))
        assertEquals(operationIds(tasks.ir) - setOf("archiveTask", "payments"), public)

        val included = viewedIds(entry(""""operations": { "include": ["getTask", "listTasks", "health"], "exclude": ["health"] }"""))
        assertEquals(listOf("getTask", "listTasks"), included)
    }

    @Test
    fun matchesTagsAsOperationIds() {
        val tagged = tasks.copy(ir = withTag(tasks.ir, "getTask", "reads"))
        val outcome = EntryView.of(entry(""""operations": { "include": ["reads"] }"""), listOf(tagged, service))

        assertEquals(listOf("getTask"), ids(assertIs<EntryViewOutcome.Viewed>(outcome).apis.single().ir))
    }

    @Test
    fun refusesWhatTheNodeCliRefuses() {
        assertEquals(listOf("filter.document.unknown"), codes(entry(""""document": "partner"""")))
        assertEquals(listOf("filter.operation.unknown"), codes(entry(""""operations": { "exclude": ["nothing"] }""")))
        assertEquals(
            listOf("filter.include.removed"),
            codes(entry(""""document": "public", "operations": { "include": ["archiveTask"] }""")),
        )
        assertEquals(listOf("config.api.unknown"), codes(entry(api = "missing")))
        assertEquals(listOf("config.api.ambiguous"), codes(entry(), listOf(tasks, tasks.copy(source = "other"))))
        assertEquals(listOf("config.api.duplicate"), codes(entry(apis = listOf("tasks", "contract/tasks"))))
    }

    @Test
    fun keepsTheRestOfTheIrAsItIs() {
        val viewed = assertIs<EntryViewOutcome.Viewed>(EntryView.of(entry(""""document": "public""""), listOf(tasks))).apis.single().ir

        assertEquals(tasks.ir - "operations", viewed - "operations")
    }

    @Test
    fun usesTheSourcesThatMayHoldAnApiNamedAloneAsTheNodeCliDoes(@TempDir directory: Path) {
        Files.createDirectories(directory.resolve(".git"))
        Files.createDirectories(directory.resolve("listing")).resolve("workspace.yaml").toFile().writeText("workspace:\n  apis:\n    tasks: tasks.yaml\n")
        Files.createDirectories(directory.resolve("other")).resolve("api.yaml").toFile().writeText("api:\n  name: billing\n")
        Files.createDirectories(directory.resolve("unreadable"))
        val file = Files.createDirectories(directory.resolve("app")).resolve(AppConfigReader.FILE_NAME)
        file.toFile().writeText(
            "sources:\n  listing: { path: ../listing }\n  other: { path: ../other }\n  unreadable: { path: ../unreadable }\n" +
                "  bundle: { release: { url: 'https://example.com/b.tgz' } }\n  named: { path: ../named }\n" +
                "targets:\n  - { id: a, use: 'g:a', api: tasks }\n  - { id: b, use: 'g:b', api: named/x }\n",
        )
        val config = assertIs<AppConfigRead.Read>(AppConfigReader.readFile(file)).config

        assertEquals(listOf("listing", "unreadable", "bundle", "named"), EntryView.usedSources(config))
    }

    private fun irOf(api: String): JsonObject = Json.parseToJsonElement(Files.readString(golden.resolve("$api.ir.json"))).jsonObject

    private fun entry(members: String = "", api: String = "tasks", apis: List<String>? = null): AppConfigEntry {
        val target = if (apis == null) """"api": "$api"""" else """"apis": [${apis.joinToString(", ") { "\"$it\"" }}]"""
        val extra = if (members.isEmpty()) "" else ", $members"
        val json = Json.parseToJsonElement("""{ "id": "server", "use": "g:a", $target$extra }""").jsonObject

        return AppConfigEntry(json, Path.of("out"))
    }

    private fun viewedIds(entry: AppConfigEntry): List<String> =
        ids(assertIs<EntryViewOutcome.Viewed>(EntryView.of(entry, listOf(tasks, service))).apis.single().ir)

    private fun codes(entry: AppConfigEntry, apis: List<SourceApi> = listOf(tasks, service)): List<String> =
        assertIs<EntryViewOutcome.Refused>(EntryView.of(entry, apis)).problems.map { it.code }

    private fun operationIds(ir: JsonObject): List<String> = ids(ir)

    private fun ids(ir: JsonObject): List<String> = (ir.getValue("operations") as JsonArray).map { it.jsonObject.getValue("id").jsonPrimitive.content }

    private fun withTag(ir: JsonObject, operationId: String, tag: String): JsonObject {
        val operations = (ir.getValue("operations") as JsonArray).map { operation ->
            val members = operation.jsonObject
            if (members.getValue("id").jsonPrimitive.content != operationId) members else JsonObject(members + ("tags" to JsonArray(listOf(JsonPrimitive(tag)))))
        }

        return JsonObject(ir + ("operations" to JsonArray(operations)))
    }
}
