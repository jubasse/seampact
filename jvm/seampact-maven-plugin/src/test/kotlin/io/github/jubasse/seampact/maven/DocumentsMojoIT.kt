package io.github.jubasse.seampact.maven

import io.github.jubasse.seampact.runner.fixtures.ReferenceApp
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.deleteIfExists
import kotlin.io.path.readLines
import kotlin.io.path.writeText
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// seampact's OpenAPI documents are the pinned binary's (ADR 0010): the generate and check goals ask it for them
// unless `openapi` is `none`, handing over the bundles the plugin checked and the POM's config, in the build directory.
class DocumentsMojoIT {
    @TempDir
    lateinit var directory: Path

    @Test
    fun asksTheDocumentsOnlyWhenOpenApiIsNotNone() {
        val app = MavenApp(directory)
        val config = ReferenceApp.CONFIG.replace(GRADLE_OUT_DIR, MAVEN_OUT_DIR)
        app.write("seampact.config.yaml", config)
        app.writePom(app.stubBinaryElement())

        val withoutDocuments = app.run("verify")
        assertTrue(withoutDocuments.succeeded, "the build with `openapi: none` succeeds")
        assertEquals(setOf(COMPILE), app.stubMarker.readLines().toSet(), "the binary only compiles the path source")

        app.stubMarker.deleteIfExists()
        app.write("seampact.config.yaml", config.lines().filterNot { it.trim() == OPENAPI_NONE }.joinToString("\n"))

        val withDocuments = app.run("verify")
        assertTrue(withDocuments.succeeded, "the build with documents succeeds")
        assertEquals(setOf(COMPILE, GENERATE, CHECK), app.stubMarker.readLines().toSet(), "each goal asks for the documents")
        assertTrue("seampact: compiler: ${ReferenceApp.STUB_DOCUMENTS_LINE} check" in withDocuments.output, withDocuments.output)
    }

    @Test
    fun handsTheCheckedBundleAndTheConfigToTheBinaryAndRemovesTheConfig() {
        val app = MavenApp(directory)
        val repository = directory.resolve("repository")
        ReferenceApp.publishValidBundle(repository)
        app.writePom(
            """
            ${app.stubBinaryElement()}
            <allowLocal>true</allowLocal>
            <outDir>$MAVEN_OUT_DIR</outDir>
            <openapi><t>openapi/t.yaml</t></openapi>
            <sources>
              <contract><maven>${ReferenceApp.VALID_BUNDLE_COORDINATES}</maven><integrity>${ReferenceApp.VALID_BUNDLE_INTEGRITY}</integrity></contract>
            </sources>
            """,
            repositories = "<repository><id>bundles</id><url>${repository.toUri()}</url></repository>",
        )

        val handedOver = app.run("verify")
        assertTrue(handedOver.succeeded, handedOver.output)
        assertEquals(
            listOf(GENERATE, APP_DIRECTORY, "$BUNDLE_DIRECTORY contract", CHECK, APP_DIRECTORY, "$BUNDLE_DIRECTORY contract"),
            app.stubMarker.readLines(),
            "the binary reads the POM's config as the app's and gets the verified bundle, never fetching it",
        )
        assertEquals(emptyList(), runDirectoriesLeft(), "the config handed to the binary is removed")

        ReferenceApp.failMarkerOf(app.stubMarker).writeText("")
        val refused = app.run("verify")
        assertFalse(refused.succeeded, "the binary's refusal fails the build")
        assertTrue(ReferenceApp.STUB_REFUSAL_LINE in refused.output, refused.output)
        assertEquals(emptyList(), runDirectoriesLeft(), "the config handed to the binary is removed after a refusal")
    }

    // The run directories a documents run leaves under the build's temporary directory.
    private fun runDirectoriesLeft(): List<Path> {
        val temporaryDirectory = directory.resolve(TEMPORARY_DIRECTORY)
        if (!Files.exists(temporaryDirectory)) return emptyList()

        return Files.list(temporaryDirectory).use { files -> files.filter { it.fileName.toString().startsWith(RUN_DIRECTORY_PREFIX) }.toList() }
    }

    private companion object {
        const val APP_DIRECTORY = "app-directory"
        const val BUNDLE_DIRECTORY = "bundle-directory"
        const val TEMPORARY_DIRECTORY = "target/seampact"
        const val RUN_DIRECTORY_PREFIX = "documents-"
        const val COMPILE = "compile"
        const val GENERATE = "generate"
        const val CHECK = "check"
        const val OPENAPI_NONE = "openapi: none"
        const val GRADLE_OUT_DIR = "build/generated/sources/seampact/main"
        const val MAVEN_OUT_DIR = "target/generated-sources/seampact"
    }
}
