package io.github.jubasse.seampact.ir.bundle

import java.io.ByteArrayOutputStream
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.Path
import java.util.zip.GZIPOutputStream
import kotlin.test.Test
import kotlin.test.assertEquals

// The caps every reader shares, and a pax size past the archive, refuse by name: a tarball too large compressed,
// a gzip bomb, too many entries, a size that would overflow; a directory with too many or too large files.
class BundleCapsTest {
    private val blockBytes = 512

    @Test
    fun aTarballOverTheCompressedCapIsRefused() {
        assertEquals(BundleFailureCode.ARCHIVE_TOO_LARGE, refusedCode(ByteArray(BUNDLE_ARCHIVE_BYTES_MAX + 1)))
    }

    @Test
    fun aGzipBombIsRefusedWhileItInflates() {
        val zeros = ByteArray(blockBytes * 1024)
        val bomb = gzipped { output -> repeat(BUNDLE_EXTRACTED_BYTES_MAX / zeros.size + 1) { output.write(zeros) } }

        assertEquals(BundleFailureCode.ARCHIVE_EXTRACTED_TOO_LARGE, refusedCode(bomb))
    }

    @Test
    fun aTarballWithTooManyEntriesIsRefused() {
        val tarball = gzipped { output ->
            output.write(header("sources/", '5', 0))
            repeat(BUNDLE_ENTRIES_MAX + 1) { index -> output.write(header("sources/f$index.yaml", '0', 0)) }
            output.write(ByteArray(blockBytes * 2))
        }

        assertEquals(BundleFailureCode.ARCHIVE_TOO_MANY_ENTRIES, refusedCode(tarball))
    }

    @Test
    fun aPaxSizeNearTheLongLimitIsAnInvalidArchive() {
        val record = "28 size=${Long.MAX_VALUE}\n".toByteArray()
        val tarball = gzipped { output ->
            output.write(header("PaxHeader", 'x', record.size.toLong()))
            output.write(record.copyOf(blockBytes))
            output.write(header("sources/api.yaml", '0', 0))
            output.write(ByteArray(blockBytes * 2))
        }

        assertEquals(BundleFailureCode.ARCHIVE_INVALID, refusedCode(tarball))
    }

    @Test
    fun aDirectoryWithTooManyFilesIsRefused() {
        val directory = Files.createTempDirectory("seampact-caps-")
        try {
            val sources = Files.createDirectory(directory.resolve("sources"))
            repeat(BUNDLE_ENTRIES_MAX + 1) { index -> Files.createFile(sources.resolve("f$index.yaml")) }

            assertEquals(BundleFailureCode.TOO_MANY_FILES, verifiedCode(directory))
        } finally {
            directory.toFile().deleteRecursively()
        }
    }

    @Test
    fun aDirectoryOverTheSizeCapIsRefused() {
        val directory = Files.createTempDirectory("seampact-caps-")
        try {
            // A sparse file: its size counts, no byte is written.
            RandomAccessFile(directory.resolve("large.bin").toFile(), "rw").use { it.setLength(BUNDLE_EXTRACTED_BYTES_MAX + 1L) }

            assertEquals(BundleFailureCode.TOO_LARGE, verifiedCode(directory))
        } finally {
            directory.toFile().deleteRecursively()
        }
    }

    private fun refusedCode(tarball: ByteArray): BundleFailureCode {
        val read = BundleTarball.read(tarball)
        check(read is BundleArchiveRead.Refused) { "the tarball was read: $read" }

        return read.failures.single().code
    }

    private fun verifiedCode(directory: Path): BundleFailureCode {
        val result = BundleVerifier.verify(directory, null, BundleChannel.RELEASE)
        check(result is BundleVerifyResult.Refused) { "the directory was verified: $result" }

        return result.failures.single().code
    }

    private fun gzipped(write: (GZIPOutputStream) -> Unit): ByteArray {
        val bytes = ByteArrayOutputStream()
        GZIPOutputStream(bytes).use(write)

        return bytes.toByteArray()
    }

    // A ustar header with its checksum.
    private fun header(name: String, type: Char, size: Long): ByteArray {
        val header = ByteArray(blockBytes)
        fun put(offset: Int, text: String) = text.toByteArray().copyInto(header, offset)

        put(0, name)
        put(100, "0000644\u0000")
        put(124, "%011o\u0000".format(size))
        put(148, " ".repeat(8))
        put(156, type.toString())
        put(257, "ustar\u000000")
        put(148, "%06o\u0000 ".format(header.sumOf { it.toInt() and 0xff }))

        return header
    }
}
