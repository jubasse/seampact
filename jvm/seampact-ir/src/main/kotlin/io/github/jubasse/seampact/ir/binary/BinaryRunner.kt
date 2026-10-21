package io.github.jubasse.seampact.ir.binary

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.read.IrReader
import io.github.jubasse.seampact.ir.read.IrSupport
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.util.concurrent.TimeUnit
import kotlin.io.path.name

/** One api the binary compiled: the IR text it wrote, byte for byte, and the IR read from it. */
public class CompiledApi(public val api: String, public val irText: String, public val ir: ContractIR)

/** The outcome of [BinaryRunner.compile]. */
public sealed interface BinaryCompileResult {
    /** Each api of the app config's sources, in api name order. */
    public data class Compiled(val apis: List<CompiledApi>) : BinaryCompileResult

    /** The binary exited with [exitCode]; its two streams, unchanged, hold its diagnostics. */
    public data class Failed(val exitCode: Int, val stdout: String, val stderr: String) : BinaryCompileResult

    /** The binary did not finish within the deadline and was stopped. */
    public data class TimedOut(val failure: BinaryFailure) : BinaryCompileResult
}

/**
 * Compiles local YAML sources with the pinned standalone binary (ADR 0010, "How a native plugin gets the IR"): runs
 * `compile --config <app config> --out <temporary directory>` from the app config's directory, then reads each
 * `<api>.ir.json` with [IrReader] under the caller's support. A non-zero exit is passed through with the binary's
 * own diagnostics.
 */
public object BinaryRunner {
    /** How long a compile may take before it is stopped. */
    public val DEFAULT_TIMEOUT: Duration = Duration.ofMinutes(5)

    private const val IR_FILE_SUFFIX = ".ir.json"

    /**
     * @throws io.github.jubasse.seampact.ir.read.IrRefusedException an IR the [support] does not read
     * @throws io.github.jubasse.seampact.ir.read.IrMalformedException an IR file that is not an IR
     */
    public fun compile(
        binary: VerifiedBinary,
        appConfig: Path,
        support: IrSupport,
        timeout: Duration = DEFAULT_TIMEOUT,
    ): BinaryCompileResult {
        val workDirectory = Files.createTempDirectory("seampact-compile-")
        try {
            val irDirectory = workDirectory.resolve("ir")
            val stdout = workDirectory.resolve("stdout.txt")
            val stderr = workDirectory.resolve("stderr.txt")
            val configFile = appConfig.toAbsolutePath()

            val process = ProcessBuilder(binary.path.toString(), "compile", "--config", configFile.toString(), "--out", irDirectory.toString())
                .directory(configFile.parent.toFile())
                .redirectOutput(stdout.toFile())
                .redirectError(stderr.toFile())
                .start()
            // The binary reads no input: its standard input is closed at once.
            process.outputStream.close()

            if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                process.destroyForcibly().waitFor()
                return BinaryCompileResult.TimedOut(timedOut(timeout))
            }

            if (process.exitValue() != 0) {
                return BinaryCompileResult.Failed(process.exitValue(), Files.readString(stdout), Files.readString(stderr))
            }

            return BinaryCompileResult.Compiled(readIrs(irDirectory, support))
        } finally {
            workDirectory.toFile().deleteRecursively()
        }
    }

    private fun readIrs(irDirectory: Path, support: IrSupport): List<CompiledApi> {
        // `compile --out` creates the directory even for no api; its absence after a success is a binary fault.
        check(Files.isDirectory(irDirectory)) { "binary: the compile exited 0 and wrote no '$irDirectory'." }

        val irFiles = Files.list(irDirectory).use { files -> files.filter { it.name.endsWith(IR_FILE_SUFFIX) }.sorted().toList() }

        return irFiles.map { file ->
            val text = Files.readString(file)
            CompiledApi(file.name.removeSuffix(IR_FILE_SUFFIX), text, IrReader.read(text, support))
        }
    }

    private fun timedOut(timeout: Duration): BinaryFailure = BinaryFailure(
        code = BinaryFailureCode.COMPILE_TIMEOUT,
        message = "The standalone compiler did not finish within ${timeout.toSeconds()} s and was stopped.",
        fix = "Run the compile again; if it hangs again, report it with the contract that makes it hang.",
        expected = timeout.toSeconds().toString(),
    )
}
