package io.github.jubasse.seampact.ir.bundle

// The ustar entries of a bundle tarball (POSIX.1-1988 with pax extended headers), read from the uncompressed bytes,
// each checked before the next is read.

private const val BLOCK_BYTES = 512
private const val NUL: Byte = 0
private const val SPACE = 0x20
private const val NEWLINE: Byte = 0x0a

private class UstarField(val offset: Int, val length: Int)

private val NAME = UstarField(0, 100)
private val SIZE = UstarField(124, 12)
private val CHECKSUM = UstarField(148, 8)
private val TYPE = UstarField(156, 1)
private val MAGIC = UstarField(257, 6)
private val VERSION = UstarField(263, 2)
private val PREFIX = UstarField(345, 155)

// The magic and version fields read as one, as GNU writes them.
private val GNU_MAGIC_FIELD = UstarField(MAGIC.offset, MAGIC.length + VERSION.length)

private const val USTAR_MAGIC = "ustar\u0000"
private const val USTAR_VERSION = "00"
// GNU tar's magic and version, one 8-byte field: read like ustar's, since its regular and directory entries agree.
private const val GNU_MAGIC_AND_VERSION = "ustar  \u0000"

private const val TYPE_FILE = "0"
// Pre-POSIX archives mark a regular file with a NUL type.
private const val TYPE_FILE_OLD = "\u0000"
private const val TYPE_DIRECTORY = "5"
private const val PAX_TYPE_EXTENDED = "x"
private const val PAX_TYPE_GLOBAL = "g"

private val OCTAL = Regex("^[0-7]+$")
private val DECIMAL = Regex("^[0-9]+$")
private val DRIVE_PATH = Regex("^[A-Za-z]:")
private val TOP_DIRECTORIES = listOf(BUNDLE_SOURCES_DIRECTORY, BUNDLE_IR_DIRECTORY)
private const val OCTAL_RADIX = 8

private class PaxOverrides(var path: String? = null, var size: Long? = null)

internal class UstarParser(private val archive: ByteArray) {
    private var offset = 0
    private var entryCount = 0
    private var pax = PaxOverrides()
    private val files = mutableListOf<BundleEntry>()

    // Paths folded to ASCII lower case: of the files, and of every directory (an entry's or a file's parent).
    private val fileByFold = HashMap<String, String>()
    private val directoryFolds = HashSet<String>()

    fun parse(): BundleArchiveRead {
        while (true) {
            if (offset + BLOCK_BYTES > archive.size) return archiveRefused(archiveInvalid("it ends before its end-of-archive block"))

            val header = archive.copyOfRange(offset, offset + BLOCK_BYTES)
            if (header.all { it == NUL }) return BundleArchiveRead.Read(files.toList())

            val failure = entry(header)
            if (failure != null) return archiveRefused(failure)
        }
    }

    private fun entry(header: ByteArray): BundleFailure? {
        entryCount++
        if (entryCount > BUNDLE_ENTRIES_MAX) {
            return BundleFailure(
                code = BundleFailureCode.ARCHIVE_TOO_MANY_ENTRIES,
                message = "The tarball holds more than $BUNDLE_ENTRIES_MAX entries.",
                fix = NOT_A_BUNDLE_FIX,
                expected = BUNDLE_ENTRIES_MAX.toString(),
            )
        }

        val headerProblem = headerProblem(header)
        if (headerProblem != null) return archiveInvalid(headerProblem)

        val type = text(header, TYPE)
        val path = pax.path ?: headerPath(header)
        val size = pax.size ?: octal(header, SIZE) ?: return archiveInvalid("an entry's size is not octal digits", path)

        val dataStart = offset + BLOCK_BYTES
        if (dataStart + size > archive.size) return archiveInvalid("it ends inside an entry", path)

        // Within the archive, so within an Int.
        val dataEnd = dataStart + size.toInt()
        val data = archive.copyOfRange(dataStart, dataEnd)
        offset = dataStart + padded(size.toInt())

        return typed(type, path, data)
    }

    private fun typed(type: String, path: String, data: ByteArray): BundleFailure? {
        if (type == PAX_TYPE_GLOBAL) return null

        if (type == PAX_TYPE_EXTENDED) {
            return when (val read = paxOverrides(data)) {
                is PaxRead.Read -> { pax = read.overrides; null }
                is PaxRead.Invalid -> archiveInvalid(read.problem, path)
            }
        }

        pax = PaxOverrides()

        if (type == TYPE_DIRECTORY) return directory(path)
        if (type == TYPE_FILE || type == TYPE_FILE_OLD) return file(path, data)

        return BundleFailure(
            BundleFailureCode.ARCHIVE_ENTRY_TYPE,
            "The tarball entry ${quoted(path)} is of type ${quoted(type)}; a bundle holds regular files only.",
            "Rebuild the bundle with `seampact bundle`: it writes no link, device or other special entry.",
            path,
        )
    }

    private fun headerProblem(header: ByteArray): String? {
        val magic = text(header, MAGIC, keepNul = true)
        val version = text(header, VERSION, keepNul = true)

        if (magic != USTAR_MAGIC && magic + version != GNU_MAGIC_AND_VERSION) return "an entry is not a ustar header"
        if (magic == USTAR_MAGIC && version != USTAR_VERSION) return "an entry has an unknown ustar version"
        if (octal(header, CHECKSUM) != checksum(header).toLong()) return "an entry header's checksum does not match"

        return null
    }

    private fun directory(path: String): BundleFailure? {
        val trimmed = path.removeSuffix("/")
        val problem = directoryPathProblem(trimmed)
        if (problem != null) return unsafePath(path, problem)

        if (bundlePathFold(trimmed) in fileByFold) return unsafePath(path, "is both a file and a directory")

        addParentDirectories(trimmed)
        directoryFolds += bundlePathFold(trimmed)

        return null
    }

    private fun file(path: String, data: ByteArray): BundleFailure? {
        val problem = filePathProblem(path)
        if (problem != null) return unsafePath(path, problem)

        val folded = bundlePathFold(path)
        val seen = fileByFold[folded]
        if (seen != null) {
            return BundleFailure(
                BundleFailureCode.ARCHIVE_ENTRY_DUPLICATE,
                if (seen == path) "The tarball holds ${quoted(path)} twice."
                else "The tarball holds ${quoted(path)} and ${quoted(seen)}, one file on a case-insensitive file system.",
                "Rebuild the bundle with `seampact bundle`: it writes each file once.",
                path,
            )
        }

        if (folded in directoryFolds || parentPaths(path).any { bundlePathFold(it) in fileByFold }) {
            return unsafePath(path, "is both a file and a directory")
        }

        fileByFold[folded] = path
        addParentDirectories(path)
        files += BundleEntry(path, data)

        return null
    }

    private fun addParentDirectories(path: String) {
        for (parent in parentPaths(path)) directoryFolds += bundlePathFold(parent)
    }
}

// `a`, `a/b` for `a/b/c`.
private fun parentPaths(path: String): List<String> {
    val segments = path.split("/")

    return (1 until segments.size).map { count -> segments.take(count).joinToString("/") }
}

private fun unsafePath(path: String, problem: String): BundleFailure = BundleFailure(
    BundleFailureCode.ARCHIVE_ENTRY_PATH,
    "The tarball entry ${quoted(path)} $problem; a bundle holds its manifest and portable paths under sources/ and ir/ only.",
    "Rebuild the bundle with `seampact bundle`: its entries are the manifest and portable paths under the bundle root.",
    path,
)

// The manifest, or a portable bundle path.
private fun filePathProblem(path: String): String? {
    if (path == BUNDLE_MANIFEST_FILE) return null

    return entryPathProblem(path) ?: bundlePathProblem(path)
}

// `sources`, `ir`, or a directory a portable bundle path may hold.
private fun directoryPathProblem(path: String): String? {
    if (path in TOP_DIRECTORIES) return null

    return entryPathProblem(path) ?: bundlePathProblem(path)
}

// The unsafe paths, named before the portable rule so the refusal says what makes them unsafe.
private fun entryPathProblem(path: String): String? = when {
    path.isEmpty() -> "has an empty path"
    '\u0000' in path -> "holds a NUL character"
    '\\' in path -> "holds a backslash"
    path.startsWith("/") || DRIVE_PATH.containsMatchIn(path) -> "is an absolute path"
    path.split("/").any { it == "" || it == "." || it == ".." } -> "has an empty, '.' or '..' segment"
    else -> null
}

// GNU headers hold times where ustar holds the prefix: their path is the name field only.
private fun headerPath(header: ByteArray): String {
    val name = text(header, NAME)
    val prefix = if (text(header, GNU_MAGIC_FIELD, keepNul = true) == GNU_MAGIC_AND_VERSION) "" else text(header, PREFIX)

    return if (prefix == "") name else "$prefix/$name"
}

// A field's text up to its first NUL; a byte that is not UTF-8 reads as U+FFFD, which no bundle path holds.
private fun text(header: ByteArray, field: UstarField, keepNul: Boolean = false): String {
    val end = field.offset + field.length
    val firstNul = if (keepNul) -1 else (field.offset until end).firstOrNull { header[it] == NUL } ?: -1

    return String(header, field.offset, (if (firstNul == -1) end else firstNul) - field.offset, Charsets.UTF_8)
}

// Octal digits, with the leading and trailing spaces and NULs tar writers leave; base-256 sizes are refused.
private fun octal(header: ByteArray, field: UstarField): Long? {
    val digits = text(header, field, keepNul = true).trim(' ', '\u0000')

    return if (OCTAL.matches(digits)) digits.toLongOrNull(OCTAL_RADIX) else null
}

// The header checksum: the byte sum with the checksum field read as eight spaces.
private fun checksum(header: ByteArray): Int =
    header.indices.sumOf { index ->
        if (index >= CHECKSUM.offset && index < CHECKSUM.offset + CHECKSUM.length) SPACE else header[index].toInt() and 0xff
    }

private fun padded(size: Int): Int = (size + BLOCK_BYTES - 1) / BLOCK_BYTES * BLOCK_BYTES

private sealed interface PaxRead {
    class Read(val overrides: PaxOverrides) : PaxRead

    class Invalid(val problem: String) : PaxRead
}

// A pax extended header's records, `<length> <key>=<value>\n`: `path` and `size` are read, the others ignored.
private fun paxOverrides(data: ByteArray): PaxRead {
    val overrides = PaxOverrides()
    var offset = 0

    while (offset < data.size) {
        val space = (offset until data.size).firstOrNull { data[it].toInt() == SPACE }
        val lengthText = if (space == null) "" else String(data, offset, space - offset, Charsets.UTF_8)
        val length = if (DECIMAL.matches(lengthText)) lengthText.toIntOrNull() else null

        if (space == null || length == null || length <= 0 || offset + length > data.size) {
            return PaxRead.Invalid("a pax record's length is not a number inside the header")
        }

        val recordEnd = offset + length - 1
        val record = if (space + 1 <= recordEnd) String(data, space + 1, recordEnd - space - 1, Charsets.UTF_8) else ""
        val equals = record.indexOf('=')
        if (equals == -1 || data[recordEnd] != NEWLINE) return PaxRead.Invalid("a pax record is not key=value")

        val key = record.substring(0, equals)
        val value = record.substring(equals + 1)
        if (key == "path") overrides.path = value
        if (key == "size") {
            if (!DECIMAL.matches(value)) return PaxRead.Invalid("a pax size is not a decimal number")
            overrides.size = value.toLongOrNull() ?: return PaxRead.Invalid("a pax size is not a decimal number")
        }

        offset += length
    }

    return PaxRead.Read(overrides)
}
