package io.github.jubasse.seampact.gradle

import org.gradle.testkit.runner.TaskOutcome
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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

    // `frameworkDocs: off` puts the generated properties file on the classpath, and without the `springSecurity`
    // option the security beans follow spring-security-web on the compile classpath.
    @Test
    fun putsTheFrameworkDocsFileOnTheClasspathAndTurnsSecurityOnFromTheClasspath() {
        val app = SampleApp(directory)
        app.write("seampact.config.yaml", SampleApp.REFERENCE_CONFIG.replace(PACKAGE_OPTION, "$PACKAGE_OPTION\n            frameworkDocs: off"))
        app.writeBuildScript("seampact {\n${app.stubBinaryBlock()}\n}", SECURITY_STARTER)

        app.run("compileJava", "processResources")

        val properties = directory.resolve("build/resources/main/seampact-tasks.properties")
        assertTrue(properties.exists(), "the properties file is a resource")
        assertTrue("springdoc.api-docs.enabled=false" in properties.readText(), "it turns springdoc's document off")
        assertFalse(directory.resolve("build/resources/main/com").exists(), "the generated sources are not resources")
        val security = directory.resolve("build/classes/java/main/com/example/tasks/api/spring/TasksSecurityConfiguration.class")
        assertTrue(security.exists(), "the security beans are generated and compile")
    }

    private companion object {
        const val PACKAGE_OPTION = "options: { package: com.example.tasks.api }"
        const val SECURITY_STARTER = "implementation(\"org.springframework.boot:spring-boot-starter-security\")"
    }
}
