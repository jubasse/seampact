package io.github.jubasse.seampact.gradle

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.deleteExisting
import kotlin.io.path.isRegularFile
import kotlin.io.path.readText
import kotlin.io.path.relativeTo
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The DSL and the file are two forms of one app config (A42): the same keys generate the same files, and an app
// with both is refused, naming both.
class FileAndDslConflictTest {
    @TempDir
    lateinit var directory: Path

    private val referenceDsl = """
        outDir = "build/generated/sources/seampact/main"
        openapi { none() }
        source("contract") { path = "contract" }
        target("server") {
            use = "io.github.jubasse:seampact-spring-boot"
            api = "tasks"
            operations { include = listOf("health", "getChannel", "getDraft", "getTask", "getTasksBatch", "searchTasks") }
            options = mapOf("package" to "com.example.tasks.api")
        }
    """

    @Test
    fun theDslGeneratesWhatTheFileDoesAndBothAreRefused() {
        val app = SampleApp(directory)
        val generated = directory.resolve("build/generated/sources/seampact/main")
        app.write("seampact.config.yaml", SampleApp.REFERENCE_CONFIG)
        app.writeBuildScript("seampact {\n${app.stubBinaryBlock()}\n}")
        app.run("seampactGenerate")
        val fromFile = treeOf(generated)

        app.writeBuildScript("seampact {\n${app.stubBinaryBlock()}\n$referenceDsl\n}")
        val both = app.fail("seampactGenerate")
        assertTrue("config.file.beside-dsl" in both.output, both.output)

        directory.resolve("seampact.config.yaml").deleteExisting()
        generated.toFile().deleteRecursively()
        app.run("seampactGenerate")

        assertEquals(fromFile, treeOf(generated))
    }

    private fun treeOf(root: Path): Map<String, String> = Files.walk(root).use { paths ->
        paths.filter { it.isRegularFile() }.toList().associate { it.relativeTo(root).toString() to it.readText() }
    }
}
