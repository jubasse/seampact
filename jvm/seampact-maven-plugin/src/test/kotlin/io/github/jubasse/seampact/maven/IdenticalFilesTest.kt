package io.github.jubasse.seampact.maven

import io.github.jubasse.seampact.ir.write.MANIFEST_FILE_NAME
import io.github.jubasse.seampact.runner.fixtures.ReferenceApp
import org.gradle.testkit.runner.GradleRunner
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Both plugins call the same generator (ADR 0010 "Native artifacts"): the Gradle plugin from `seampact.config.yaml`
// and the Maven plugin from the same keys in its `<configuration>` write identical files, which are the spring-boot
// golden tree with the generated header.
class IdenticalFilesTest {
    @TempDir
    lateinit var gradleDirectory: Path

    @TempDir
    lateinit var mavenDirectory: Path

    @Test
    fun bothPluginsWriteTheSameFilesAsTheGolden() {
        val gradleRoot = generateWithGradle()
        val mavenRoot = generateWithMaven()

        val gradleTree = ENTRY_IDS.associateWith { treeOf(gradleRoot.resolve(it)) }
        val mavenTree = ENTRY_IDS.associateWith { treeOf(mavenRoot.resolve(it)) }
        assertEquals(gradleTree, mavenTree, "the Gradle and Maven plugins write the same files")

        // The writer's manifest of each root is its own record, not generated code: the golden has none.
        val generatedFiles = gradleTree.values.flatMap { it.entries }.filter { (path, _) -> path != MANIFEST_FILE_NAME }
        val withoutHeaders = generatedFiles.associate { (path, text) ->
            assertTrue(text.startsWith(HEADER_START), "$path starts with the generated header")
            path to text.substringAfter('\n')
        }
        assertEquals(goldenTree(), withoutHeaders, "the plugins write the spring-boot golden tree")
    }

    private fun generateWithGradle(): Path {
        ReferenceApp.copyContract(gradleDirectory)
        val stub = gradleDirectory.resolve("stub-seampact")
        ReferenceApp.writeStubBinary(stub, gradleDirectory.resolve("stub-ran"))
        write(gradleDirectory, "settings.gradle.kts", "rootProject.name = \"sample-app\"")
        write(gradleDirectory, "seampact.config.yaml", CONSUMER_CONFIG)
        write(
            gradleDirectory,
            "build.gradle.kts",
            """
            plugins {
                java
                id("io.github.jubasse.seampact")
            }

            repositories { mavenCentral() }

            dependencies {
                implementation(platform("org.springframework.boot:spring-boot-dependencies:${System.getProperty("seampact.springBootVersion")}"))
                implementation("org.springframework.boot:spring-boot-starter-webmvc")
            }

            seampact {
                binary {
                    path = file("stub-seampact")
                    sha256 = "${ReferenceApp.sha256Of(stub)}"
                }
            }
            """,
        )

        GradleRunner.create()
            .withProjectDir(gradleDirectory.toFile())
            .withPluginClasspath(System.getProperty("seampact.gradlePluginClasspath").split(File.pathSeparator).map(::File))
            .withTestKitDir(File(System.getProperty("seampact.testKitDirectory")))
            .withArguments("seampactGenerate", "--stacktrace")
            .forwardOutput()
            .build()

        return gradleDirectory.resolve("build/generated/sources/seampact/main")
    }

    private fun generateWithMaven(): Path {
        val app = MavenApp(mavenDirectory)
        app.writePom(CONSUMER_CONFIGURATION + app.stubBinaryElement())

        val run = app.run("generate-sources")
        assertTrue(run.succeeded, "the Maven build generates the app from its <configuration>")

        return mavenDirectory.resolve("target/generated-sources/seampact")
    }

    private fun goldenTree(): Map<String, String> =
        treeOf(ReferenceApp.repositoryRoot.resolve("jvm/seampact-spring-boot/src/test/golden"))

    private fun write(directory: Path, relativePath: String, text: String) {
        ReferenceApp.writeFile(directory, relativePath, text)
    }

    private companion object {
        const val HEADER_START = "// "
        val ENTRY_IDS = listOf("tasks", "tasksService")

        // The golden tree's apis, each in its own package: every operation of tasks, getTask of tasksService.
        const val CONSUMER_CONFIG = """
            outDir: build/generated/sources/seampact/main
            openapi: none
            sources:
              contract: { path: contract }
            targets:
              - id: tasks
                use: io.github.jubasse:seampact-spring-boot
                api: tasks
                options: { package: com.example.tasks.api }
              - id: tasksService
                use: io.github.jubasse:seampact-spring-boot
                api: tasksService
                operations: { include: [getTask] }
                options: { package: com.example.tasksservice.api }
            """

        // The same keys as the Maven plugin's <configuration>.
        const val CONSUMER_CONFIGURATION = """
            <outDir>target/generated-sources/seampact</outDir>
            <openapi>none</openapi>
            <sources><contract><path>contract</path></contract></sources>
            <targets>
              <target>
                <id>tasks</id>
                <use>io.github.jubasse:seampact-spring-boot</use>
                <api>tasks</api>
                <options><package>com.example.tasks.api</package></options>
              </target>
              <target>
                <id>tasksService</id>
                <use>io.github.jubasse:seampact-spring-boot</use>
                <api>tasksService</api>
                <operations><include><operation>getTask</operation></include></operations>
                <options><package>com.example.tasksservice.api</package></options>
              </target>
            </targets>
            """
    }
}
