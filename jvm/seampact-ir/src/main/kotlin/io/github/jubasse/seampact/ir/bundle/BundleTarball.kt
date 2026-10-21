package io.github.jubasse.seampact.ir.bundle

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.util.zip.GZIPInputStream

/** One regular file of a bundle tarball: its path and bytes. */
public class BundleEntry(public val path: String, public val bytes: ByteArray)

/** The files of a bundle tarball, or the one failure that refuses it. */
public sealed interface BundleArchiveRead {
    public data class Read(val entries: List<BundleEntry>) : BundleArchiveRead

    public data class Refused(val failures: List<BundleFailure>) : BundleArchiveRead
}

/** A bundle tarball extracted into a new temporary directory the caller removes, or the failure that refuses it. */
public sealed interface BundleArchiveExtraction {
    public data class Extracted(val directory: Path) : BundleArchiveExtraction

    public data class Refused(val failures: List<BundleFailure>) : BundleArchiveExtraction
}

/**
 * The bundle tarball reader (`schemas/bundle/README.md`, "Tarball"), with the JDK's gzip only. A tarball comes from
 * the network, so it is read whole in memory and every entry checked before any byte is written: regular files and
 * directories only, pax extended headers for `path` and `size` only, global pax headers ignored, every other type
 * refused; a file is the manifest or a portable bundle path, a directory one of their parents; no duplicate (also
 * once folded to ASCII lower case) or path that is both a file and a directory; the caps of every reader. Entry
 * names are untrusted: quoted in messages, kept exact in `file`. The codes are those of `tarball-read.ts`.
 */
public object BundleTarball {
    private const val TEMPORARY_PREFIX = "seampact-bundle-"

    public fun read(tarball: ByteArray): BundleArchiveRead {
        if (tarball.size > BUNDLE_ARCHIVE_BYTES_MAX) {
            return archiveRefused(
                BundleFailure(
                    code = BundleFailureCode.ARCHIVE_TOO_LARGE,
                    message = "The tarball holds ${tarball.size} bytes, over the cap of $BUNDLE_ARCHIVE_BYTES_MAX.",
                    fix = NOT_A_BUNDLE_FIX,
                    expected = BUNDLE_ARCHIVE_BYTES_MAX.toString(),
                    actual = tarball.size.toString(),
                ),
            )
        }

        return when (val archive = gunzipped(tarball)) {
            is Gunzipped.Archive -> UstarParser(archive.bytes).parse()
            is Gunzipped.Refused -> archiveRefused(archive.failure)
        }
    }

    /** Extracts a bundle tarball into a new temporary directory the caller removes, or refuses it whole. */
    public fun extract(tarball: ByteArray): BundleArchiveExtraction {
        val entries = when (val read = read(tarball)) {
            is BundleArchiveRead.Read -> read.entries
            is BundleArchiveRead.Refused -> return BundleArchiveExtraction.Refused(read.failures)
        }

        val directory = Files.createTempDirectory(TEMPORARY_PREFIX)
        try {
            for (entry in entries) {
                val target = entry.path.split("/").fold(directory) { parent, segment -> parent.resolve(segment) }
                Files.createDirectories(target.parent)
                Files.write(target, entry.bytes, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
            }
        } catch (error: IOException) {
            directory.toFile().deleteRecursively()
            throw IllegalStateException("bundle: writing the checked tarball entries into '$directory' failed: $error", error)
        }

        return BundleArchiveExtraction.Extracted(directory)
    }
}

internal fun archiveRefused(failure: BundleFailure): BundleArchiveRead = BundleArchiveRead.Refused(listOf(failure))

internal fun archiveInvalid(reason: String, file: String? = null): BundleFailure =
    BundleFailure(BundleFailureCode.ARCHIVE_INVALID, "The tarball cannot be read: $reason.", REBUILD_FIX, file)

private sealed interface Gunzipped {
    class Archive(val bytes: ByteArray) : Gunzipped

    data class Refused(val failure: BundleFailure) : Gunzipped
}

private const val COPY_BUFFER_BYTES = 64 * 1024

private fun gunzipped(tarball: ByteArray): Gunzipped {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(COPY_BUFFER_BYTES)

    try {
        GZIPInputStream(ByteArrayInputStream(tarball)).use { input ->
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (output.size().toLong() + read > BUNDLE_EXTRACTED_BYTES_MAX) {
                    return Gunzipped.Refused(
                        BundleFailure(
                            code = BundleFailureCode.ARCHIVE_EXTRACTED_TOO_LARGE,
                            message = "The tarball holds more than $BUNDLE_EXTRACTED_BYTES_MAX bytes once uncompressed.",
                            fix = NOT_A_BUNDLE_FIX,
                            expected = BUNDLE_EXTRACTED_BYTES_MAX.toString(),
                        ),
                    )
                }
                output.write(buffer, 0, read)
            }
        }
    } catch (error: IOException) {
        return Gunzipped.Refused(archiveInvalid("it is not gzip data (${quoted(error.message ?: error.toString())})"))
    }

    return Gunzipped.Archive(output.toByteArray())
}
