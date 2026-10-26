package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.runner.fixtures.ReferenceApp
import org.gradle.testkit.runner.TaskOutcome
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readLines
import kotlin.io.path.writeText
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// seampact's OpenAPI documents are the pinned binary's (ADR 0010): generate and check ask it for them unless
// `openapi` is `none`, from the file or from the DSL, which the binary reads as a file in the build's temporary
// directory, removed after the run; a bundle source is handed over as the bundle the plugin checked.
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

        assertEquals(listOf(COMPILE, GENERATE, APP_DIRECTORY), app.stubMarker.readLines(), "the DSL config is read as the app directory's")
        assertEquals(emptyList(), runDirectoriesLeft(), "the DSL config handed to the binary is removed")
    }

    @Test
    fun removesTheDslConfigAfterARefusedRun() {
        val app = SampleApp(directory)
        app.writeBuildScript("seampact {\n${app.stubBinaryBlock()}\n${REFERENCE_DSL}\n}")
        ReferenceApp.failMarkerOf(app.stubMarker).writeText("")

        val refused = app.fail("seampactGenerate")

        assertTrue("binary.documents-refused" in refused.output && ReferenceApp.STUB_REFUSAL_LINE in refused.output, refused.output)
        assertEquals(emptyList(), runDirectoriesLeft(), "the DSL config handed to the binary is removed after a refusal")
    }

    @Test
    fun handsTheCheckedBundleOfABundleSourceToTheBinary() {
        val app = SampleApp(directory)
        ReferenceApp.publishValidBundle(directory.resolve("repository"))
        app.write(
            "seampact.config.yaml",
            """
            allowLocal: true
            outDir: build/generated/sources/seampact/main
            openapi: { t: openapi/t.yaml }
            sources:
              contract: { maven: '${ReferenceApp.VALID_BUNDLE_COORDINATES}', integrity: '${ReferenceApp.VALID_BUNDLE_INTEGRITY}' }
            targets: []
            """,
        )
        app.writeBuildScript("repositories { maven { url = uri(\"repository\") } }\nseampact {\n${app.stubBinaryBlock()}\n}")

        app.run("seampactGenerate", "seampactCheck")

        assertEquals(
            listOf(CHECK, "$BUNDLE_DIRECTORY contract", GENERATE, "$BUNDLE_DIRECTORY contract"),
            app.stubMarker.readLines(),
            "the binary gets the verified bundle and never fetches it",
        )
    }

    @Test
    fun fetchesNoBundleSourceTheDocumentsDoNotRead() {
        val app = SampleApp(directory)
        ReferenceApp.publishValidBundle(directory.resolve("repository"))
        app.write(
            "seampact.config.yaml",
            """
            allowLocal: true
            outDir: build/generated/sources/seampact/main
            sources:
              contract: { maven: '${ReferenceApp.VALID_BUNDLE_COORDINATES}', integrity: '${ReferenceApp.VALID_BUNDLE_INTEGRITY}' }
              staging: { maven: 'com.example:unpublished:9.9.9', integrity: '$UNPUBLISHED_INTEGRITY' }
            targets:
              - { id: web, use: '@seampact/nestjs', api: contract/t }
            """,
        )
        app.writeBuildScript("repositories { maven { url = uri(\"repository\") } }\nseampact {\n${app.stubBinaryBlock()}\n}")

        app.run("seampactGenerate")

        assertEquals(listOf(GENERATE, "$BUNDLE_DIRECTORY contract"), app.stubMarker.readLines(), "only the source the documents read is fetched")
    }

    @Test
    fun runsAgainWhileTheDefaultDocumentsAreUnlisted() {
        val app = SampleApp(directory)
        app.write("seampact.config.yaml", withoutOpenApiNone(SampleApp.REFERENCE_CONFIG))
        app.writeBuildScript("seampact {\n${app.stubBinaryBlock()}\n}")

        app.run("seampactGenerate")
        val again = app.run("seampactGenerate")

        assertEquals(TaskOutcome.SUCCESS, again.task(":seampactGenerate")?.outcome, "a deleted default document is written again")
    }

    // The run directories a documents run leaves under the build's temporary directory.
    private fun runDirectoriesLeft(): List<Path> {
        val temporaryDirectory = directory.resolve(TEMPORARY_DIRECTORY)
        if (!Files.exists(temporaryDirectory)) return emptyList()

        return Files.list(temporaryDirectory).use { it.toList() }
    }

    private fun withoutOpenApiNone(config: String): String = config.lines().filterNot { it.trim() == OPENAPI_NONE }.joinToString("\n")

    private companion object {
        const val COMPILE = "compile"
        const val GENERATE = "generate"
        const val CHECK = "check"
        const val OPENAPI_NONE = "openapi: none"
        const val APP_DIRECTORY = "app-directory"
        const val UNPUBLISHED_INTEGRITY = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        const val BUNDLE_DIRECTORY = "bundle-directory"
        const val TEMPORARY_DIRECTORY = "build/tmp/seampact"

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
