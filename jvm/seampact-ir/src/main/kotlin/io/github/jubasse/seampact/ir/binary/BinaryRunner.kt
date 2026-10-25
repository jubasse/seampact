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
    /** Each api the binary wrote, in api name order. */
    public data class Compiled(val apis: List<CompiledApi>) : BinaryCompileResult

    /**
     * The binary refused the compile (exit 1) or its usage (exit 2); its two streams hold its diagnostics, with
     * control characters other than newline and tab removed.
     */
    public data class Failed(val exitCode: Int, val stdout: String, val stderr: String) : BinaryCompileResult

    /** The binary or its cache changed after it was installed, and it was not started. */
    public data class Refused(val failure: BinaryFailure) : BinaryCompileResult

    /** The binary left its contract (`binary.compile-failed`): an unknown exit, a signal, or a missing IR file. */
    public data class OutsideContract(val failure: BinaryFailure) : BinaryCompileResult

    /** The binary did not finish within the deadline and was stopped. */
    public data class TimedOut(val failure: BinaryFailure) : BinaryCompileResult
}

/**
 * Compiles local YAML sources with the pinned standalone binary (ADR 0010, "Amendment 2026-10-21: the JVM channels",
 * Runner and Exits): checks the private cache and hashes the copy right before it starts, runs
 * `compile --config <app config> --out <temporary directory>` from the app config's directory with only the
 * environment variables the binary reads, then reads each `<api>.ir.json` with [IrReader] under the caller's support.
 */
public object BinaryRunner {
    /** How long a compile may take before it is stopped. */
    public val DEFAULT_TIMEOUT: Duration = Duration.ofMinutes(5)

    private const val IR_FILE_SUFFIX = ".ir.json"
    private const val SIGNAL_EXIT_BASE = 128
    private val CONTRACT_REFUSAL_EXITS = setOf(1, 2)

    // The binary's contract: it reads no other environment variable.
    private val CONTRACT_VARIABLES = setOf("TMPDIR", "TEMP", "TMP")
    private const val WINDOWS_SYSTEM_ROOT = "SYSTEMROOT"

    private val CONTROL_CHARACTERS_BUT_NEWLINE_AND_TAB = Regex("[\\p{Cc}&&[^\\n\\t]]")

    /**
     * The JVM's compile config names one entry, so an exit 0 that wrote no IR file left the contract.
     *
     * @throws io.github.jubasse.seampact.ir.read.IrRefusedException an IR the [support] does not read
     * @throws io.github.jubasse.seampact.ir.read.IrMalformedException an IR file that is not an IR
     */
    public fun compile(
        binary: VerifiedBinary,
        appConfig: Path,
        support: IrSupport,
        timeout: Duration = DEFAULT_TIMEOUT,
    ): BinaryCompileResult {
        val unsafeEntry = BinaryCache.unsafeEntry(binary.path, binary.cacheRoot)
        if (unsafeEntry != null) return BinaryCompileResult.Refused(unsafeEntry)
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
            keepContractVariables(processBuilder.environment(), BinaryCache.isWindows())

            val process = processBuilder.start()
            // The binary reads no input: its standard input is closed at once.
            process.outputStream.close()

            if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                process.destroyForcibly().waitFor()
                return BinaryCompileResult.TimedOut(timedOut(timeout))
            }

            val exitCode = process.exitValue()
            if (exitCode in CONTRACT_REFUSAL_EXITS) {
                return BinaryCompileResult.Failed(exitCode, withoutControlCharacters(Files.readString(stdout)), withoutControlCharacters(Files.readString(stderr)))
            }
            if (exitCode != 0) return BinaryCompileResult.OutsideContract(unknownExit(exitCode))

            return readIrs(irDirectory, support)
        } finally {
            workDirectory.toFile().deleteRecursively()
        }
    }

    private fun readIrs(irDirectory: Path, support: IrSupport): BinaryCompileResult {
        if (!Files.isDirectory(irDirectory)) return BinaryCompileResult.OutsideContract(irMissing())

        val irFiles = Files.list(irDirectory).use { files -> files.filter { it.name.endsWith(IR_FILE_SUFFIX) }.sorted().toList() }
        if (irFiles.isEmpty()) return BinaryCompileResult.OutsideContract(irMissing())

        return BinaryCompileResult.Compiled(
            irFiles.map { file ->
                val text = Files.readString(file)
                CompiledApi(file.name.removeSuffix(IR_FILE_SUFFIX), text, IrReader.read(text, support))
            },
        )
    }

    /** Keeps only the variables of the binary's contract; Windows names are case-insensitive, so the match is too. */
    internal fun keepContractVariables(environment: MutableMap<String, String>, windows: Boolean) {
        val kept = if (windows) CONTRACT_VARIABLES + WINDOWS_SYSTEM_ROOT else CONTRACT_VARIABLES
        environment.keys.removeIf { name -> name.uppercase() !in kept }
    }

    internal fun withoutControlCharacters(text: String): String = text.replace(CONTROL_CHARACTERS_BUT_NEWLINE_AND_TAB, "")

    private fun unknownExit(exitCode: Int): BinaryFailure {
        // A POSIX child stopped by a signal reports 128 plus the signal number.
        val stoppedBy = if (!BinaryCache.isWindows() && exitCode > SIGNAL_EXIT_BASE) "was stopped by the signal ${exitCode - SIGNAL_EXIT_BASE}" else "exited with $exitCode"

        return BinaryFailure(
            code = BinaryFailureCode.COMPILE_FAILED,
            message = "The standalone compiler $stoppedBy, outside its exits 0, 1 and 2.",
            fix = "Run the build again; if it fails the same way, report it with the binary version and the contract.",
            actual = exitCode.toString(),
        )
    }

    private fun irMissing(): BinaryFailure = BinaryFailure(
        code = BinaryFailureCode.COMPILE_FAILED,
        message = "The standalone compiler exited 0 without writing an IR file (<api>$IR_FILE_SUFFIX).",
        fix = "Use a compiler binary of the plugin's seampact release; report it if they match.",
        expected = "<api>$IR_FILE_SUFFIX",
    )

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
