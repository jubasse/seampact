package io.github.jubasse.seampact.ir.binary

import io.github.jubasse.seampact.ir.read.IrSupport
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import org.junit.jupiter.api.condition.EnabledIfSystemProperty

// The standalone binary given by `-PseampactBinary=<path>` compiles the reference contract through the runner, and
// each IR it writes is byte-identical to the committed golden IR. Without the property the test is skipped: the
// binary is built by the Node job, never by the Java one.
@EnabledIfSystemProperty(named = "seampact.binary", matches = ".+")
class BinaryRunnerTest {
    private val repositoryRoot = Path.of(System.getProperty("seampact.repositoryRoot"))
    private val apis = listOf("tasks", "tasksService")

    // The app config of the binary smoke (`packages/tools/binary/scripts/smoke-apps.mjs`): `compile` reads the
    // sources the targets use and never loads the target package.
    private val appConfig = """
        sources:
          contract: { path: ./contract }
        targets:
          - { id: server, use: seampact-smoke-target, apis: [${apis.joinToString(", ")}] }

    """.trimIndent()

    @Test
    fun theReferenceContractCompilesToTheGoldenIr() {
        val app = Files.createTempDirectory("seampact-runner-")
        try {
            repositoryRoot.resolve("fixtures/reference").toFile().copyRecursively(app.resolve("contract").toFile())
            val config = Files.writeString(app.resolve("seampact.config.yaml"), appConfig)
            val binary = Path.of(System.getProperty("seampact.binary"))
            val install = BinaryInstaller.install(binary, BinaryPin.LocalFile(binary, BinaryInstaller.sha256Of(binary)), app.resolve("cache"))
            check(install is BinaryInstall.Installed) { "the binary was refused: $install" }

            val result = BinaryRunner.compile(install.binary, config, IrSupport.ofModel(kinds = listOf("httpOperation")))

            check(result is BinaryCompileResult.Compiled) { "the binary failed: $result" }
            assertEquals(apis.sorted(), result.apis.map { it.api })
            for (compiled in result.apis) {
                val golden = repositoryRoot.resolve("fixtures/golden/reference/${compiled.api}.ir.json").readText()
                assertEquals(golden, compiled.irText, compiled.api)
            }
        } finally {
            app.toFile().deleteRecursively()
        }
    }
}
