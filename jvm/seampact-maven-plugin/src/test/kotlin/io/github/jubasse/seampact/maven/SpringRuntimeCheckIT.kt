package io.github.jubasse.seampact.maven

import io.github.jubasse.seampact.runner.fixtures.ReferenceApp
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// The generate goal's check of the runtime the POM declares (ADR 0025, G2): refused with nothing written when the
// compile classpath has none or one of another `major.minor`.
class SpringRuntimeCheckIT {
    @TempDir
    lateinit var directory: Path

    @Test
    fun refusesAGenerateWhenThePomDeclaresNoRuntime() {
        val app = MavenApp(directory)
        app.write("seampact.config.yaml", ReferenceApp.CONFIG.replace(GRADLE_OUT_DIR, MAVEN_OUT_DIR))
        app.writePom(app.stubBinaryElement(), runtimeVersion = null)

        val run = app.run("generate-sources")

        assertFalse(run.succeeded, "the build fails")
        assertTrue("runtime.missing" in run.output, "the refusal names the rule")
        assertTrue("<artifactId>seampact-spring-runtime</artifactId>" in run.output, "the fix gives the dependency block")
        assertFalse(writesAnyFile(), "a refused generate writes nothing")
    }

    @Test
    fun refusesARuntimeOfAnotherMinor() {
        val app = MavenApp(directory)
        ReferenceApp.publishSpringRuntime(directory.resolve(OTHER_RUNTIME_REPOSITORY), OTHER_RUNTIME_VERSION)
        app.write("seampact.config.yaml", ReferenceApp.CONFIG.replace(GRADLE_OUT_DIR, MAVEN_OUT_DIR))
        app.writePom(
            app.stubBinaryElement(),
            "<repository><id>other-runtime</id><url>${directory.resolve(OTHER_RUNTIME_REPOSITORY).toUri()}</url></repository>",
            OTHER_RUNTIME_VERSION,
        )

        val run = app.run("generate-sources")

        assertFalse(run.succeeded, "the build fails")
        assertTrue("runtime.version-mismatch" in run.output, "the refusal names the rule")
        assertTrue("`io.github.jubasse:seampact-spring-runtime $OTHER_RUNTIME_VERSION` is installed" in run.output, "it names the installed runtime")
        assertFalse(writesAnyFile(), "a refused generate writes nothing")
    }

    private fun writesAnyFile(): Boolean {
        val root = directory.resolve(MAVEN_OUT_DIR)
        if (!root.exists()) return false

        return Files.walk(root).use { paths -> paths.anyMatch(Files::isRegularFile) }
    }

    private companion object {
        const val GRADLE_OUT_DIR = "build/generated/sources/seampact/main"
        const val MAVEN_OUT_DIR = "target/generated-sources/seampact"
        const val OTHER_RUNTIME_REPOSITORY = "other-runtime-repository"
        const val OTHER_RUNTIME_VERSION = "999.1.0"
    }
}
