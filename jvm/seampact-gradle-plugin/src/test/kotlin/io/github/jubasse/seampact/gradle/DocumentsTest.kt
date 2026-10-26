package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.runner.fixtures.ReferenceApp
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.name
import kotlin.io.path.readLines
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// seampact's OpenAPI documents are the pinned binary's (ADR 0010): generate and check ask it for them unless
// `openapi` is `none`, from the file or from the DSL, which the binary reads as a file removed after the run.
class DocumentsTest {
    @TempDir
    lateinit var directory: Path

    @Test
    fun asksNoDocumentWhenOpenApiIsNone() {
        val app = SampleApp(directory)
        app.write("seampact.config.yaml", SampleApp.REFERENCE_CONFIG)
        app.writeBuildScript("seampact {\n${app.stubBinaryBlock()}\n}")

        app.run("seampactGenerate", "seampactCheck")

        assertEquals(setOf(COMPILE), app.stubMarker.readLines().toSet(), "the binary only compiles the path source")
    }

    @Test
    fun asksTheDocumentsOfTheFileConfigOnGenerateAndCheck() {
        val app = SampleApp(directory)
        app.write("seampact.config.yaml", withoutOpenApiNone(SampleApp.REFERENCE_CONFIG))
        app.writeBuildScript("seampact {\n${app.stubBinaryBlock()}\n}")

        val run = app.run("seampactGenerate", "seampactCheck")

        assertEquals(setOf(COMPILE, GENERATE, CHECK), app.stubMarker.readLines().toSet(), "each task asks for the documents")
        assertTrue("seampact: compiler: ${ReferenceApp.STUB_DOCUMENTS_LINE} generate" in run.output, run.output)
        assertTrue("seampact: compiler: ${ReferenceApp.STUB_DOCUMENTS_LINE} check" in run.output, run.output)
    }

    @Test
    fun handsTheDslConfigToTheBinaryAndRemovesIt() {
        val app = SampleApp(directory)
        app.writeBuildScript("seampact {\n${app.stubBinaryBlock()}\n${REFERENCE_DSL}\n}")

        app.run("seampactGenerate")

        assertEquals(listOf(COMPILE, GENERATE), app.stubMarker.readLines())
        val leftConfigs = Files.list(directory).use { files -> files.filter { it.name.startsWith(DSL_CONFIG_PREFIX) }.toList() }
        assertEquals(emptyList(), leftConfigs, "the DSL config handed to the binary is removed")
    }

    private fun withoutOpenApiNone(config: String): String = config.lines().filterNot { it.trim() == OPENAPI_NONE }.joinToString("\n")

    private companion object {
        const val COMPILE = "compile"
        const val GENERATE = "generate"
        const val CHECK = "check"
        const val OPENAPI_NONE = "openapi: none"
        const val DSL_CONFIG_PREFIX = ".seampact-build-config-"

        const val REFERENCE_DSL = """
            outDir = "build/generated/sources/seampact/main"
            source("contract") { path = "contract" }
            target("server") {
                use = "io.github.jubasse:seampact-spring-boot"
                api = "tasks"
                operations { include = listOf("health", "getChannel", "getDraft", "getTask", "getTasksBatch", "searchTasks") }
                options = mapOf("package" to "com.example.tasks.api")
            }
        """
    }
}
