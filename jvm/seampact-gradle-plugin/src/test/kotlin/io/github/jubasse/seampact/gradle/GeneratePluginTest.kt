package io.github.jubasse.seampact.gradle

import org.gradle.testkit.runner.TaskOutcome
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The plugin end to end on the reference contract: the generated sources compile with the app, a second run is
// up to date, a cleaned build takes them from the build cache, and the configuration cache is reused.
class GeneratePluginTest {
    @TempDir
    lateinit var directory: Path

    private val cached = arrayOf("--build-cache", "--configuration-cache")

    @Test
    fun generatesCompilesAndCaches() {
        val app = SampleApp(directory)
        app.write("seampact.config.yaml", SampleApp.REFERENCE_CONFIG)
        app.writeBuildScript("seampact {\n${app.stubBinaryBlock()}\n}")

        val first = app.run("compileJava", *cached)
        assertEquals(TaskOutcome.SUCCESS, first.task(":seampactGenerate")?.outcome)
        assertEquals(TaskOutcome.SUCCESS, first.task(":compileJava")?.outcome)
        val handlers = directory.resolve("build/classes/java/main/com/example/tasks/api/TasksEndpoints.class")
        assertTrue(handlers.exists(), "the generated endpoints interface compiles")

        val second = app.run("compileJava", *cached)
        assertEquals(TaskOutcome.UP_TO_DATE, second.task(":seampactGenerate")?.outcome)
        assertTrue("Reusing configuration cache." in second.output, "the configuration cache is reused")

        val cleaned = app.run("clean", "compileJava", *cached)
        assertEquals(TaskOutcome.FROM_CACHE, cleaned.task(":seampactGenerate")?.outcome)

    }
}
