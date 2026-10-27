package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.runner.fixtures.ReferenceApp
import org.gradle.testkit.runner.BuildResult
import org.gradle.testkit.runner.GradleRunner
import java.nio.file.Files
import java.nio.file.Path

/**
 * A throwaway Spring Boot app built by TestKit with the plugin under test: the reference contract as a `path`
 * source in `contract/`, compiled by a stub binary that writes the golden IR, so no Node and no release is needed.
 */
internal class SampleApp(val directory: Path) {
    val stubBinary: Path = directory.resolve("stub-seampact")
    val stubMarker: Path = directory.resolve("stub-ran")

    init {
        ReferenceApp.copyContract(directory)
        ReferenceApp.writeStubBinary(stubBinary, stubMarker)

        write(
            "settings.gradle.kts",
            """
            rootProject.name = "sample-app"
            buildCache { local { directory = file("build-cache") } }
            """,
        )
        writeBuildScript("")
    }

    /**
     * Writes the build file, with [seampactBlock] after the plugin's setup, [extraDependencies] in `dependencies` and
     * [extraRepositories] before the others.
     */
    fun writeBuildScript(seampactBlock: String, extraDependencies: String = "", extraRepositories: String = "") {
        val classpath = System.getProperty("seampact.sampleAppClasspath").split(java.io.File.pathSeparator)
            .joinToString(", ") { "\"${it.replace("\\", "/")}\"" }
        write("build.gradle.kts", buildScript(classpath, seampactBlock, extraDependencies, extraRepositories))
    }

    // The seampact modules, seampact-spring-runtime among them, come from the root build's file repository.
    private fun buildScript(classpath: String, seampactBlock: String, extraDependencies: String, extraRepositories: String): String =
        """
        plugins {
            java
            id("io.github.jubasse.seampact")
        }

        repositories {
            $extraRepositories
            maven {
                url = uri("${Path.of(System.getProperty("seampact.testRepository")).toUri()}")
                content { includeGroup("io.github.jubasse") }
            }
            mavenCentral()
        }

        dependencies {
            implementation(platform("org.springframework.boot:spring-boot-dependencies:${System.getProperty("seampact.springBootVersion")}"))
            implementation("org.springframework.boot:spring-boot-starter-webmvc")
            implementation("org.springframework.boot:spring-boot-starter-validation")
            implementation(files($classpath))
            $extraDependencies
        }

        $seampactBlock
        """.trimIndent()

    fun write(relativePath: String, text: String) {
        ReferenceApp.writeFile(directory, relativePath, text)
    }

    /** The `binary { }` block that pins the stub binary by its hash. */
    fun stubBinaryBlock(sha256: String = sha256Of(stubBinary)): String =
        """
        binary {
            path = file("stub-seampact")
            sha256 = "$sha256"
        }
        """

    fun run(vararg arguments: String, environment: Map<String, String> = emptyMap()): BuildResult =
        runner(arguments, environment).build()

    fun fail(vararg arguments: String, environment: Map<String, String> = emptyMap()): BuildResult =
        runner(arguments, environment).buildAndFail()

    private fun runner(arguments: Array<out String>, environment: Map<String, String>): GradleRunner {
        writeRetryKeysIntoTestKitHome()

        val runner = GradleRunner.create()
            .withProjectDir(directory.toFile())
            .withPluginClasspath()
            .withTestKitDir(Path.of(System.getProperty("seampact.testKitDirectory")).toFile())
            .withArguments(*arguments, "--stacktrace")
            .withEnvironment(System.getenv().filterKeys { it != ALLOW_LOCAL_VARIABLE } + environment)
            .forwardOutput()
        val gradleVersion = System.getProperty("seampact.testGradle")

        return if (gradleVersion == null) runner else runner.withGradleVersion(gradleVersion)
    }

    // The TestKit Gradle user home is not the runner's, so it gets the repository's retry keys itself.
    private fun writeRetryKeysIntoTestKitHome() {
        val testKitDirectory = Path.of(System.getProperty("seampact.testKitDirectory"))
        val propertiesFile = testKitDirectory.resolve("gradle.properties")

        Files.createDirectories(testKitDirectory)
        val retryLines = Files.readAllLines(REPOSITORY_PROPERTIES).filter { it.startsWith(RETRY_KEY_PREFIX) }

        check(retryLines.isNotEmpty()) { "No retry keys found in $REPOSITORY_PROPERTIES" }
        Files.write(propertiesFile, retryLines)
    }

    companion object {
        // Gradle runs tests from the project directory, so the shared properties file is one level up.
        private val REPOSITORY_PROPERTIES: Path = Path.of("..", "gradle.properties")

        private const val RETRY_KEY_PREFIX = "systemProp.org.gradle.internal.repository."

        const val ALLOW_LOCAL_VARIABLE = "SEAMPACT_ALLOW_LOCAL"

        const val REFERENCE_CONFIG = ReferenceApp.CONFIG

        fun sha256Of(file: Path): String = ReferenceApp.sha256Of(file)
    }
}
