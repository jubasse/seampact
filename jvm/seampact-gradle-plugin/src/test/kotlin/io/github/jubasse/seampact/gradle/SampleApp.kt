package io.github.jubasse.seampact.gradle

import org.gradle.testkit.runner.BuildResult
import org.gradle.testkit.runner.GradleRunner
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.HexFormat
import kotlin.io.path.absolutePathString
import kotlin.io.path.createDirectories
import kotlin.io.path.writeText

/**
 * A throwaway Spring Boot app built by TestKit with the plugin under test: the reference contract as a `path`
 * source in `contract/`, compiled by a stub binary that writes the golden IR, so no Node and no release is needed.
 */
internal class SampleApp(val directory: Path) {
    val stubBinary: Path = directory.resolve("stub-seampact")
    val stubMarker: Path = directory.resolve("stub-ran")

    init {
        val repositoryRoot = Path.of(System.getProperty("seampact.repositoryRoot"))
        repositoryRoot.resolve("fixtures/reference").toFile().copyRecursively(directory.resolve("contract").toFile())
        writeStubBinary(repositoryRoot.resolve("fixtures/golden/reference"))

        write(
            "settings.gradle.kts",
            """
            rootProject.name = "sample-app"
            buildCache { local { directory = file("build-cache") } }
            """,
        )
        writeBuildScript("")
    }

    /** Writes the build file, with [seampactBlock] after the plugin's setup. */
    fun writeBuildScript(seampactBlock: String) {
        val classpath = System.getProperty("seampact.sampleAppClasspath").split(java.io.File.pathSeparator)
            .joinToString(", ") { "\"${it.replace("\\", "/")}\"" }
        write("build.gradle.kts", buildScript(classpath, seampactBlock))
    }

    private fun buildScript(classpath: String, seampactBlock: String): String =
        """
        plugins {
            java
            id("io.github.jubasse.seampact")
        }

        repositories { mavenCentral() }

        dependencies {
            implementation(platform("org.springframework.boot:spring-boot-dependencies:${System.getProperty("seampact.springBootVersion")}"))
            implementation("org.springframework.boot:spring-boot-starter-webmvc")
            implementation("org.springframework.boot:spring-boot-starter-validation")
            implementation(files($classpath))
        }

        $seampactBlock
        """.trimIndent()

    fun write(relativePath: String, text: String) {
        val file = directory.resolve(relativePath)
        file.parent.createDirectories()
        file.writeText(text.trimIndent() + "\n")
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

    // A stub of the compiler binary: it marks that it ran, then writes the golden IR where `--out` points.
    private fun writeStubBinary(golden: Path) {
        stubBinary.writeText(
            """
            #!/bin/sh
            touch '${stubMarker.absolutePathString()}'
            out=""
            while [ "${'$'}#" -gt 0 ]; do
              if [ "${'$'}1" = "--out" ]; then out="${'$'}2"; fi
              shift
            done
            mkdir -p "${'$'}out"
            cp '${golden.resolve("tasks.ir.json")}' '${golden.resolve("tasksService.ir.json")}' "${'$'}out/"
            """.trimIndent() + "\n",
        )
        stubBinary.toFile().setExecutable(true)
    }

    companion object {
        const val ALLOW_LOCAL_VARIABLE = "SEAMPACT_ALLOW_LOCAL"

        /** The reference app config: the core operations of `tasks` the spring-boot target generates today. */
        const val REFERENCE_CONFIG = """
            outDir: build/generated/sources/seampact/main
            openapi: none
            sources:
              contract: { path: contract }
            targets:
              - id: server
                use: io.github.jubasse:seampact-spring-boot
                api: tasks
                operations: { include: [health, getChannel, getDraft, getTask, getTasksBatch, searchTasks] }
                options: { package: com.example.tasks.api }
            """

        fun sha256Of(file: Path): String = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file)))
    }
}
