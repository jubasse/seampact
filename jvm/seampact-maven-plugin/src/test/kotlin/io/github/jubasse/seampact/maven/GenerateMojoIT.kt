package io.github.jubasse.seampact.maven

import io.github.jubasse.seampact.ir.config.LocalSourcePolicy
import io.github.jubasse.seampact.runner.fixtures.ReferenceApp
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.deleteIfExists
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// The plugin end to end on the reference contract through a real Maven: the generated sources compile with the
// app and `verify` runs the check, an offline second run skips on its stamp without starting the binary, and a
// changed SEAMPACT_ALLOW_LOCAL runs it again.
class GenerateMojoIT {
    @TempDir
    lateinit var directory: Path

    @Test
    fun generatesCompilesSkipsOnItsStampAndChecks() {
        val app = MavenApp(directory)
        app.write("seampact.config.yaml", ReferenceApp.CONFIG.replace(GRADLE_OUT_DIR, MAVEN_OUT_DIR))
        app.writePom(app.stubBinaryElement())

        val first = app.run("verify")
        assertTrue(first.succeeded, "the first build succeeds")
        assertTrue("seampact: entry 'server' wrote" in first.output, "the entry is generated")
        assertTrue(directory.resolve("target/classes/com/example/tasks/api/TasksEndpoints.class").exists(), "the generated endpoints interface compiles")
        assertTrue("checks.generated is not compared" in first.output, "verify runs the check; an outDir under target is not compared")

        app.stubMarker.deleteIfExists()
        val second = app.run("-o", "compile")
        assertTrue(second.succeeded, "the offline second build succeeds")
        assertTrue("nothing to generate" in second.output, "the second run skips on its stamp")
        assertFalse(app.stubMarker.exists(), "a skipped run does not start the binary")

        val refused = app.run("-o", "verify", extraEnvironment = mapOf(LocalSourcePolicy.ALLOW_LOCAL_VARIABLE to "false"))
        assertFalse(refused.succeeded, "SEAMPACT_ALLOW_LOCAL=false is part of the stamp, so the run refuses the path source")
        assertTrue("config.source.local" in refused.output, "the refusal names the local source")
    }

    // `frameworkDocs: off` puts the generated properties file on the classpath, not the generated sources.
    @Test
    fun putsTheFrameworkDocsFileOnTheClasspath() {
        val app = MavenApp(directory)
        val config = ReferenceApp.CONFIG.replace(GRADLE_OUT_DIR, MAVEN_OUT_DIR).replace(PACKAGE_OPTION, "$PACKAGE_OPTION\n            frameworkDocs: off")
        app.write("seampact.config.yaml", config)
        app.writePom(app.stubBinaryElement())

        val run = app.run("process-resources")
        assertTrue(run.succeeded, "the build succeeds")

        val properties = directory.resolve("target/classes/seampact-tasks.properties")
        assertTrue(properties.exists(), "the properties file is a resource")
        assertTrue("springdoc.api-docs.enabled=false" in properties.readText(), "it turns springdoc's document off")
        assertFalse(directory.resolve("target/classes/com").exists(), "the generated sources are not resources")
    }

    private companion object {
        const val PACKAGE_OPTION = "options: { package: com.example.tasks.api }"
        const val GRADLE_OUT_DIR = "build/generated/sources/seampact/main"
        const val MAVEN_OUT_DIR = "target/generated-sources/seampact"
    }
}
