package io.github.jubasse.seampact.maven

import io.github.jubasse.seampact.runner.fixtures.ReferenceApp
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.deleteIfExists
import kotlin.io.path.readLines
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// seampact's OpenAPI documents are the pinned binary's (ADR 0010): the generate and check goals ask it for them
// unless `openapi` is `none`.
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

    private companion object {
        const val COMPILE = "compile"
        const val GENERATE = "generate"
        const val CHECK = "check"
        const val OPENAPI_NONE = "openapi: none"
        const val GRADLE_OUT_DIR = "build/generated/sources/seampact/main"
        const val MAVEN_OUT_DIR = "target/generated-sources/seampact"
    }
}
