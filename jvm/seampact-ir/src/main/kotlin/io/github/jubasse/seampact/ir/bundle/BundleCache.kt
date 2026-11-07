package io.github.jubasse.seampact.ir.bundle

import java.io.IOException
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.Base64
import java.util.HexFormat
import java.util.UUID

/**
 * The bundle cache, by integrity value (ADR 0011 "Channels"), under the directory the build plugin passes. An
 * entry is written through a temporary directory and a rename, so a reader never sees half of one, and the
 * pinned-bundle check runs again on every read: the cache is a copy, never a trust input. As `cache.ts`.
 */
internal class BundleCache(private val directory: Path) {
    /** The entry directory of [integrity], or null when the value is not a SHA-256 one. */
    fun entryOf(integrity: String): Path? {
        if (!SHA256_INTEGRITY.matches(integrity)) return null

        val digest = Base64.getDecoder().decode(integrity.removePrefix(INTEGRITY_PREFIX))

        return directory.resolve(BUNDLES_DIRECTORY).resolve("sha256-${HexFormat.of().formatHex(digest)}")
    }

    /** Copies the checked bundle at [bundle] to [entry]; an entry another run wrote first is kept. */
    fun store(bundle: Path, entry: Path) {
        if (Files.exists(entry)) return

        val parent = entry.parent
        val incoming = parent.resolve("$TEMPORARY_PREFIX${UUID.randomUUID()}")
        Files.createDirectories(parent)

        try {
            copyTree(bundle, incoming)
            Files.move(incoming, entry, StandardCopyOption.ATOMIC_MOVE)
        } catch (error: IOException) {
            incoming.toFile().deleteRecursively()
            if (error is FileAlreadyExistsException || Files.exists(entry)) return

            throw IllegalStateException(
                "bundle: storing the cache entry '$entry' failed: $error. Check that the cache directory is writable.",
                error,
            )
        }
    }

    private fun copyTree(source: Path, target: Path) {
        Files.walk(source).use { paths ->
            for (path in paths) {
                val copy = target.resolve(source.relativize(path).toString())
                if (Files.isDirectory(path)) Files.createDirectories(copy) else Files.copy(path, copy)
            }
        }
    }

    private companion object {
        const val BUNDLES_DIRECTORY = "bundles"
        const val TEMPORARY_PREFIX = ".incoming-"
        const val INTEGRITY_PREFIX = "sha256-"

        // A SHA-256 digest as `sha256-` and its padded standard base64.
        val SHA256_INTEGRITY = Regex("^sha256-[A-Za-z0-9+/]{43}=$")
    }
}
