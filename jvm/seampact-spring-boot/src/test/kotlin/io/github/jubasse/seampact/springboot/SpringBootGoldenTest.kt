package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.ObjectSchema
import io.github.jubasse.seampact.ir.read.IrReader
import io.github.jubasse.seampact.ir.read.IrSupport
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.deleteExisting
import kotlin.io.path.isRegularFile
import kotlin.io.path.readText
import kotlin.io.path.relativeTo
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// The reference contract's apis generated with the core-path operations every spring-boot release serves (ADR 0022
// "The consumer and the proof"), compared byte for byte with the committed tree, which `goldenTest` then compiles
// against Spring Boot 4. `-PupdateGolden` rewrites the tree instead.
class SpringBootGoldenTest {
    private val repositoryRoot: Path = Path.of(System.getProperty("seampact.repositoryRoot"))
    private val goldenDirectory: Path = Path.of(System.getProperty("seampact.goldenDirectory"))
    private val updateGolden: Boolean = System.getProperty("seampact.updateGolden").toBoolean()

    private class GoldenApi(val irFile: String, val packageName: String, val operations: Set<String>)

    private val apis = listOf(
        GoldenApi("tasks.ir.json", "com.example.tasks.api", setOf("health", "getChannel", "getDraft", "getTask", "getTasksBatch", "searchTasks")),
        GoldenApi("tasksService.ir.json", "com.example.tasksservice.api", setOf("getTask")),
    )

    private fun referenceIr(file: String): ContractIR {
        val text = repositoryRoot.resolve("fixtures/golden/reference").resolve(file).readText()

        return IrReader.read(text, IrSupport.ofModel(kinds = listOf("httpOperation")))
    }

    // What the entry's `operations.include` keeps; the IR view of a build plugin does the same.
    private fun coreView(api: GoldenApi): ContractIR {
        val ir = referenceIr(api.irFile)

        return ir.copy(operations = ir.operations.filter { it.id in api.operations })
    }

    private fun entry(packageName: String): SpringBootEntry =
        SpringBootEntry(id = "server", options = JsonObject(mapOf("package" to JsonPrimitive(packageName))), springBootVersion = "4.1.1")

    private fun generatedTree(): Map<String, String> = apis
        .flatMap { api -> SpringBootTarget.generate(coreView(api), entry(api.packageName)) }
        .associate { it.path to it.contents }

    private fun committedTree(): Map<String, String> {
        if (!Files.isDirectory(goldenDirectory)) return emptyMap()

        return Files.walk(goldenDirectory).use { paths ->
            paths.filter { it.isRegularFile() }
                .toList()
                .associate { it.relativeTo(goldenDirectory).joinToString("/") to it.readText() }
        }
    }

    @Test
    fun generatesTheGoldenTree() {
        val generated = generatedTree()

        if (updateGolden) {
            rewriteGolden(generated)
            return
        }

        val committed = committedTree()
        assertEquals(committed.keys.sorted(), generated.keys.sorted(), "The golden file list differs; run with -PupdateGolden and review the diff.")
        for ((path, contents) in generated) {
            assertEquals(committed[path], contents, "The golden file $path differs; run with -PupdateGolden and review the diff.")
        }
    }

    @Test
    fun generatesTheSameTreeTwice() {
        assertEquals(generatedTree(), generatedTree())
    }

    @Test
    fun refusesTwoTypesOfOnePackageTakingOneName() {
        val api = apis.first()
        val ir = coreView(api)
        val task = ir.schemas.getValue("Task") as ObjectSchema
        val channel = ir.schemas.getValue("Channel") as ObjectSchema
        val collidingIr = ir.copy(schemas = ir.schemas + ("Channel" to channel.copy(name = task.name)))

        val refused = assertFailsWith<SpringBootRefusedException> { SpringBootTarget.generate(collidingIr, entry(api.packageName)) }

        val collision = refused.refusals.single { it.code == "name.collision" }
        assertTrue(collision.message.contains("com.example.tasks.api.schemas.Task"), collision.message)
        assertTrue(collision.message.contains("schema 'Channel'") && collision.message.contains("schema 'Task'"), collision.message)
    }

    @Test
    fun refusesTheFormsOfTheWholeReferenceContractByName() {
        val refused = assertFailsWith<SpringBootRefusedException> {
            SpringBootTarget.generate(referenceIr("tasks.ir.json"), entry("com.example.tasks.api"))
        }

        val codes = refused.refusals.map { it.code }.toSet()
        for (code in listOf("paging.unsupported", "idempotency.unsupported", "cache.unsupported", "signature.unsupported")) {
            assertTrue(code in codes, "expected $code among $codes")
        }
        assertTrue(refused.refusals.all { it.message.contains("spring-") || it.message.contains("no release") }, refused.message)
    }

    private fun rewriteGolden(generated: Map<String, String>) {
        for (stale in committedTree().keys - generated.keys) goldenDirectory.resolve(stale).deleteExisting()

        for ((path, contents) in generated) {
            val file = goldenDirectory.resolve(path)
            file.parent.createDirectories()
            file.writeText(contents)
        }
    }
}
