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

    /** The binary changed after it was installed and was not started. */
    public data class Refused(val failure: BinaryFailure) : BinaryCompileResult

    /** The binary did not finish within the deadline and was stopped. */
    public data class TimedOut(val failure: BinaryFailure) : BinaryCompileResult
}

/**
 * Compiles local YAML sources with the pinned standalone binary (ADR 0010, "How a native plugin gets the IR"): runs
 * `compile --config <app config> --out <temporary directory>` from the app config's directory, then reads each
 * `<api>.ir.json` with [IrReader] under the caller's support. A non-zero exit is passed through with the binary's
 * own diagnostics. The binary is hashed again right before it starts, and it starts without any `NODE_*` variable
 * of the build environment (`NODE_OPTIONS` could make it load foreign code).
 */
public object BinaryRunner {
    /** How long a compile may take before it is stopped. */
    public val DEFAULT_TIMEOUT: Duration = Duration.ofMinutes(5)

    private const val IR_FILE_SUFFIX = ".ir.json"
    private const val NODE_VARIABLE_PREFIX = "NODE_"

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
        val startedSha256 = BinaryInstaller.sha256Of(binary.path)
        if (startedSha256 != binary.sha256) return BinaryCompileResult.Refused(changedSinceInstall(binary, startedSha256))

        val workDirectory = Files.createTempDirectory("seampact-compile-")
        try {
            val irDirectory = workDirectory.resolve("ir")
            val stdout = workDirectory.resolve("stdout.txt")
            val stderr = workDirectory.resolve("stderr.txt")
            val configFile = appConfig.toAbsolutePath()

            val processBuilder = ProcessBuilder(binary.path.toString(), "compile", "--config", configFile.toString(), "--out", irDirectory.toString())
                .directory(configFile.parent.toFile())
                .redirectOutput(stdout.toFile())
                .redirectError(stderr.toFile())
            removeNodeVariables(processBuilder.environment())

            val process = processBuilder.start()
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

    /** Drops every `NODE_*` variable; Windows names are case-insensitive, so the prefix is too. */
    internal fun removeNodeVariables(environment: MutableMap<String, String>) {
        environment.keys.removeIf { name -> name.uppercase().startsWith(NODE_VARIABLE_PREFIX) }
    }

    private fun changedSinceInstall(binary: VerifiedBinary, actual: String): BinaryFailure = BinaryFailure(
        code = BinaryFailureCode.HASH_MISMATCH,
        message = "The binary '${binary.path}' has the SHA-256 $actual since it was installed; the pin is " +
            "${binary.sha256}. It is not run.",
        fix = "Check who can write to the binary cache directory, keep it private to your user, and run the build again.",
        expected = binary.sha256,
        actual = actual,
    )

    private fun timedOut(timeout: Duration): BinaryFailure = BinaryFailure(
        code = BinaryFailureCode.COMPILE_TIMEOUT,
        message = "The standalone compiler did not finish within ${timeout.toSeconds()} s and was stopped.",
        fix = "Run the compile again; if it hangs again, report it with the contract that makes it hang.",
        expected = timeout.toSeconds().toString(),
    )
}
