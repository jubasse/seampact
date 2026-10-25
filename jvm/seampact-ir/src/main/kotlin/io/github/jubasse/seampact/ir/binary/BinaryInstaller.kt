package io.github.jubasse.seampact.ir.binary

import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.PosixFilePermissions
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.HexFormat

/**
 * A binary whose bytes matched its pin when it was copied into the private cache under [cacheRoot]: the only binary
 * [BinaryRunner] starts, after checking the cache and the hash again.
 */
public class VerifiedBinary internal constructor(public val path: Path, public val sha256: String, internal val cacheRoot: Path)

/** The outcome of [BinaryInstaller.install]. */
public sealed interface BinaryInstall {
    public data class Installed(val binary: VerifiedBinary) : BinaryInstall

    public data class Refused(val failure: BinaryFailure) : BinaryInstall
}

/**
 * Installs a resolved binary for use (ADR 0010, "Amendment 2026-10-21: the JVM channels", Cache): hashes it and
 * refuses one whose SHA-256 differs from the pin (`binary.hash-mismatch`, naming both), then copies it into
 * `<cache root>/<sha256>/`, the only copy that runs. A resolved artefact and a `path` override are copied alike, so a
 * file someone else may change is never started. The cache root and each directory the runner creates are
 * owner-only whatever the umask; an unsafe cache entry is refused (`binary.cache-unsafe`, [BinaryCache]).
 */
public object BinaryInstaller {
    private const val BINARY_NAME = "seampact"
    private const val WINDOWS_SUFFIX = ".exe"
    private const val TEMPORARY_SUFFIX = ".partial"
    private const val COPY_BUFFER_BYTES = 1024 * 1024
    private const val POSIX_VIEW = "posix"
    private const val SHA_256 = "SHA-256"
    private val OWNER_ONLY_EXECUTABLE = PosixFilePermissions.fromString("rwx------")

    public fun install(resolved: Path, pin: BinaryPin, cacheDirectory: Path): BinaryInstall {
        val resolvedSha256 = sha256Of(resolved)
        if (resolvedSha256 != pin.sha256) return BinaryInstall.Refused(hashMismatch(resolved, pin.sha256, resolvedSha256))

        val cacheRoot = cacheDirectory.toAbsolutePath().normalize()
        val directory = cacheRoot.resolve(pin.sha256)
        val installed = directory.resolve(binaryFileName())
        BinaryCache.createPrivateDirectories(directory)
        val unsafeEntry = BinaryCache.unsafeEntry(installed, cacheRoot)
        if (unsafeEntry != null) return BinaryInstall.Refused(unsafeEntry)

        if (isInstalled(installed, pin.sha256)) return BinaryInstall.Installed(VerifiedBinary(installed, pin.sha256, cacheRoot))

        val partial = createOwnerOnlyFile(directory)
        try {
            // Hashed as it streams: a file changed during the copy is caught here.
            val copiedSha256 = copyHashing(resolved, partial)
            if (copiedSha256 != pin.sha256) return BinaryInstall.Refused(hashMismatch(resolved, pin.sha256, copiedSha256))
            makeExecutable(partial)

            moveIntoPlace(partial, installed, pin.sha256)
        } finally {
            Files.deleteIfExists(partial)
        }

        return BinaryInstall.Installed(VerifiedBinary(installed, pin.sha256, cacheRoot))
    }

    private fun isInstalled(installed: Path, sha256: String): Boolean =
        Files.isRegularFile(installed, LinkOption.NOFOLLOW_LINKS) && Files.isExecutable(installed) && sha256Of(installed) == sha256

    private fun createOwnerOnlyFile(directory: Path): Path {
        if (!supportsPosix(directory)) return Files.createTempFile(directory, BINARY_NAME, TEMPORARY_SUFFIX)

        val partial = Files.createTempFile(directory, BINARY_NAME, TEMPORARY_SUFFIX, PosixFilePermissions.asFileAttribute(OWNER_ONLY_EXECUTABLE))
        // The creation mode goes through the umask, so the owner-only modes are set after it.
        Files.setPosixFilePermissions(partial, OWNER_ONLY_EXECUTABLE)

        return partial
    }

    private fun copyHashing(source: Path, target: Path): String {
        val digest = MessageDigest.getInstance(SHA_256)
        DigestInputStream(Files.newInputStream(source), digest).use { input ->
            Files.newOutputStream(target, StandardOpenOption.TRUNCATE_EXISTING).use { output -> input.transferTo(output) }
        }

        return HexFormat.of().formatHex(digest.digest())
    }

    private fun makeExecutable(file: Path) {
        if (supportsPosix(file)) return

        check(file.toFile().setExecutable(true)) { "binary: '$file' could not be made executable." }
    }

    // Another build may have installed the same binary meanwhile, and Windows refuses to replace a running `.exe`:
    // an entry already there with the right hash counts as success.
    private fun moveIntoPlace(partial: Path, installed: Path, sha256: String) {
        try {
            Files.move(partial, installed, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        } catch (moveFailed: IOException) {
            if (!isInstalled(installed, sha256)) throw moveFailed
        }
    }

    private fun supportsPosix(path: Path): Boolean = POSIX_VIEW in path.fileSystem.supportedFileAttributeViews()

    private fun binaryFileName(): String = if (BinaryCache.isWindows()) BINARY_NAME + WINDOWS_SUFFIX else BINARY_NAME

    private fun hashMismatch(file: Path, expected: String, actual: String): BinaryFailure = BinaryFailure(
        code = BinaryFailureCode.HASH_MISMATCH,
        message = "The binary '$file' has the SHA-256 $actual; the pin is $expected. It is not run.",
        fix = "Resolve the binary again from a repository you trust; if it is your own build, pin its SHA-256.",
        expected = expected,
        actual = actual,
    )

    internal fun sha256Of(file: Path): String {
        val digest = MessageDigest.getInstance(SHA_256)
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
