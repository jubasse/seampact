package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.runner.fixtures.ReferenceApp
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.assertEquals

// The generate-time check of seampact-spring-runtime (ADR 0025, G2) on a classpath holding a runtime of each version.
class SpringRuntimeCheckTest {
    @TempDir
    lateinit var directory: Path

    private val buildTool = BuildTool("the test plugin", "test generate", "", "", "install it at ${BuildTool.VERSION_PLACEHOLDER}")

    private fun runtimeOf(version: String): List<Path> {
        ReferenceApp.publishSpringRuntime(directory, version)

        return listOf(directory.resolve("io/github/jubasse/seampact-spring-runtime/$version/seampact-spring-runtime-$version.jar"))
    }

    private fun problems(runtimeVersion: String?, generatorVersion: String): List<Pair<String, String>> {
        val classpath = if (runtimeVersion == null) emptyList() else runtimeOf(runtimeVersion)

        return springRuntimeProblems(classpath, buildTool, generatorVersion).map { it.code to it.message }
    }

    @Test
    fun passesTheGeneratorsVersionAndALaterPatch() {
        assertEquals(emptyList(), problems("1.4.2", "1.4.2"))
        assertEquals(emptyList(), problems("1.4.5", "1.4.2"))
    }

    @Test
    fun refusesAnAbsentRuntime() {
        assertEquals(
            listOf(RUNTIME_MISSING to "`io.github.jubasse:seampact-spring-boot 1.4.2` generates code that imports `io.github.jubasse:seampact-spring-runtime`, which this app does not install."),
            problems(null, "1.4.2"),
        )
    }

    @Test
    fun refusesAnotherMinorOrMajor() {
        for (installed in listOf("1.5.0", "1.3.9", "2.4.2")) {
            assertEquals(
                listOf(RUNTIME_VERSION_MISMATCH to "`io.github.jubasse:seampact-spring-runtime $installed` is installed, `io.github.jubasse:seampact-spring-boot 1.4.2` generates for `1.4.x`."),
                problems(installed, "1.4.2"),
            )
        }
    }

    @Test
    fun refusesALowerPatch() {
        assertEquals(
            listOf(RUNTIME_VERSION_MISMATCH to "`io.github.jubasse:seampact-spring-runtime 1.4.1` is older than the generator, `io.github.jubasse:seampact-spring-boot 1.4.2`."),
            problems("1.4.1", "1.4.2"),
        )
    }
}
