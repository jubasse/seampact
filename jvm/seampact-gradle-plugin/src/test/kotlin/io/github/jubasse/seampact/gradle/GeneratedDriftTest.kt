package io.github.jubasse.seampact.gradle

import org.gradle.testkit.runner.TaskOutcome
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.appendText
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// `checks.generated` compares committed generated files (ADR 0011, ADR 0015): an `outDir` under the build directory
// is never committed, so a fresh or cleaned `check` and `build` pass without a generate first; an `outDir` in the
// source tree is compared, and a hand edit fails `seampactCheck` with the Gradle way to fix it.
class GeneratedDriftTest {
    @TempDir
    lateinit var directory: Path

    private val cached = arrayOf("--build-cache", "--configuration-cache")

    @Test
    fun aFreshCleanCheckAndBuildPassWhenTheOutputIsUnderTheBuildDirectory() {
        val app = SampleApp(directory)
        app.write("seampact.config.yaml", SampleApp.REFERENCE_CONFIG)
        app.writeBuildScript("seampact {\n${app.stubBinaryBlock()}\n}")

        val checked = app.run("clean", "check", *cached)
        assertEquals(TaskOutcome.SUCCESS, checked.task(":seampactCheck")?.outcome)
        assertTrue("checks.generated is not compared" in checked.output, checked.output)

        val built = app.run("clean", "build", *cached)
        assertEquals(TaskOutcome.SUCCESS, built.task(":seampactCheck")?.outcome)
    }

    @Test
    fun aHandEditOfCommittedOutputFailsTheCheck() {
        val app = SampleApp(directory)
        app.write("seampact.config.yaml", SampleApp.REFERENCE_CONFIG.replace("outDir: build/generated/sources/seampact/main", ""))
        app.writeBuildScript("seampact {\n${app.stubBinaryBlock()}\n}")
        app.run("seampactGenerate", *cached)

        val checked = app.run("check", *cached)
        assertTrue("the generated files match" in checked.output, checked.output)

        directory.resolve("__generated__/server/com/example/tasks/api/TasksEndpoints.java").appendText("// edited\n")
        val drifted = app.fail("seampactCheck", *cached)

        assertTrue("check.generated.drift" in drifted.output, drifted.output)
        assertTrue("run `gradle seampactGenerate`" in drifted.output && "force option" !in drifted.output, drifted.output)
        assertFalse("Configuration cache problems" in drifted.output, "a task run alone stores its configuration cache")
    }
}
