package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.runner.fixtures.ReferenceApp
import org.gradle.testkit.runner.TaskOutcome
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// The generate-time check of the runtime the plugin adds (ADR 0025, G2): the version the main compile classpath
// resolves, refused with nothing written when it is absent or another `major.minor`.
class SpringRuntimeCheckTest {
    @TempDir
    lateinit var directory: Path

    @Test
    fun refusesAGenerateWhenTheCompileClasspathHasNoRuntime() {
        val app = SampleApp(directory)
        app.write("seampact.config.yaml", SampleApp.REFERENCE_CONFIG)
        app.writeBuildScript(
            "seampact {\n${app.stubBinaryBlock()}\n}\n" +
                "configurations.implementation { exclude(group = \"io.github.jubasse\", module = \"seampact-spring-runtime\") }",
        )

        val result = app.fail("seampactGenerate")

        assertEquals(TaskOutcome.FAILED, result.task(":seampactGenerate")?.outcome)
        assertTrue("runtime.missing" in result.output, result.output)
        assertTrue("generates code that imports `io.github.jubasse:seampact-spring-runtime`, which this app does not install." in result.output)
        assertFalse(writtenFiles().any(), "a refused generate writes nothing")
    }

    @Test
    fun refusesARuntimeOfAnotherMinorThatAForcedVersionResolves() {
        val app = SampleApp(directory)
        ReferenceApp.publishSpringRuntime(directory.resolve(OTHER_RUNTIME_REPOSITORY), OTHER_RUNTIME_VERSION)
        app.write("seampact.config.yaml", SampleApp.REFERENCE_CONFIG)
        app.writeBuildScript(
            "seampact {\n${app.stubBinaryBlock()}\n}",
            "implementation(\"io.github.jubasse:seampact-spring-runtime\") { version { strictly(\"$OTHER_RUNTIME_VERSION\") } }",
            "maven { url = uri(\"$OTHER_RUNTIME_REPOSITORY\") }",
        )

        val result = app.fail("seampactGenerate")

        assertEquals(TaskOutcome.FAILED, result.task(":seampactGenerate")?.outcome)
        assertTrue("runtime.version-mismatch" in result.output, result.output)
        assertTrue("`io.github.jubasse:seampact-spring-runtime $OTHER_RUNTIME_VERSION` is installed" in result.output)
        assertFalse(writtenFiles().any(), "a refused generate writes nothing")
    }

    // Gradle creates the output roots before the task runs; a refused generate leaves them empty.
    private fun writtenFiles(): Sequence<Path> {
        val root = directory.resolve(GENERATED_ROOT)
        if (!root.exists()) return emptySequence()

        return Files.walk(root).use { paths -> paths.filter(Files::isRegularFile).toList() }.asSequence()
    }

    private companion object {
        const val OTHER_RUNTIME_REPOSITORY = "other-runtime-repository"
        const val OTHER_RUNTIME_VERSION = "999.1.0"
        const val GENERATED_ROOT = "build/generated/sources/seampact"
    }
}
