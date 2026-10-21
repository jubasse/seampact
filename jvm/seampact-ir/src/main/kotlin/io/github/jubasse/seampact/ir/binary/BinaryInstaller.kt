package io.github.jubasse.seampact.ir.binary

import java.io.InputStream
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.HexFormat

/** A binary whose bytes matched its pin when it was installed: the only binary [BinaryRunner] starts. */
public class VerifiedBinary internal constructor(public val path: Path, public val sha256: String)

/** The outcome of [BinaryInstaller.install]. */
public sealed interface BinaryInstall {
    public data class Installed(val binary: VerifiedBinary) : BinaryInstall

    public data class Refused(val failure: BinaryFailure) : BinaryInstall
}

/**
 * Installs a resolved binary for use: hashes it and refuses one whose SHA-256 differs from the pin
 * (`binary.hash-mismatch`, naming both), then keeps an executable copy under `<cache>/<sha256>/` (a resolved
 * artefact carries no executable bit), hashed again before it is used. Called before every first use in a build, so
 * a binary changed in a repository or a cache is never started.
 */
public object BinaryInstaller {
    private const val BINARY_NAME = "seampact"
    private const val WINDOWS_SUFFIX = ".exe"
    private const val WINDOWS_PREFIX = "Windows"
    private const val TEMPORARY_SUFFIX = ".partial"
    private const val COPY_BUFFER_BYTES = 1024 * 1024

    public fun install(resolved: Path, pin: BinaryPin, cacheDirectory: Path): BinaryInstall {
        val resolvedSha256 = sha256Of(resolved)
        if (resolvedSha256 != pin.sha256) return BinaryInstall.Refused(hashMismatch(resolved, pin.sha256, resolvedSha256))

        val directory = cacheDirectory.resolve(pin.sha256)
        val installed = directory.resolve(binaryFileName())
        if (Files.isRegularFile(installed) && Files.isExecutable(installed) && sha256Of(installed) == pin.sha256) {
            return BinaryInstall.Installed(VerifiedBinary(installed, pin.sha256))
        }

        Files.createDirectories(directory)
        val partial = Files.createTempFile(directory, BINARY_NAME, TEMPORARY_SUFFIX)
        try {
            Files.copy(resolved, partial, StandardCopyOption.REPLACE_EXISTING)
            check(partial.toFile().setExecutable(true)) { "binary: '$partial' could not be made executable." }

            // The copy is hashed, not the source again: a file changed during the copy is caught here.
            val copiedSha256 = sha256Of(partial)
            if (copiedSha256 != pin.sha256) return BinaryInstall.Refused(hashMismatch(resolved, pin.sha256, copiedSha256))

            Files.move(partial, installed, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        } finally {
            Files.deleteIfExists(partial)
        }

        return BinaryInstall.Installed(VerifiedBinary(installed, pin.sha256))
    }

    private fun binaryFileName(): String =
        if (System.getProperty("os.name").startsWith(WINDOWS_PREFIX)) BINARY_NAME + WINDOWS_SUFFIX else BINARY_NAME

    private fun hashMismatch(file: Path, expected: String, actual: String): BinaryFailure = BinaryFailure(
        code = BinaryFailureCode.HASH_MISMATCH,
        message = "The binary '$file' has the SHA-256 $actual; the pin is $expected. It is not run.",
        fix = "Resolve the binary again from a repository you trust; if it is your own build, pin its SHA-256.",
        expected = expected,
        actual = actual,
    )

    internal fun sha256Of(file: Path): String {
        val digest = MessageDigest.getInstance("SHA-256")
        Files.newInputStream(file).use { input -> digestAll(input, digest) }

        return HexFormat.of().formatHex(digest.digest())
    }

    private fun digestAll(input: InputStream, digest: MessageDigest) {
        val buffer = ByteArray(COPY_BUFFER_BYTES)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) return
            digest.update(buffer, 0, read)
        }
    }
}
