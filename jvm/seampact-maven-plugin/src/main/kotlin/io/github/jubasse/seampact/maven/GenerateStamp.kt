package io.github.jubasse.seampact.maven

import java.io.IOException
import java.nio.file.FileSystemLoopException
import java.nio.file.FileVisitOption
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes
import java.security.MessageDigest
import java.util.HexFormat
import kotlin.io.path.createParentDirectories
import kotlin.io.path.exists
import kotlin.io.path.isDirectory
import kotlin.io.path.readLines
import kotlin.io.path.writeText

/**
 * The record of the last generate run, in the build directory: the hash of its inputs and of the files it left in
 * its outputs, the entry roots and the OpenAPI documents (each listed file, or the default `openapi` directory). The
 * goal skips when both are unchanged, as Gradle's up-to-date check does; a file edited, added or removed in an
 * output, or any changed input, runs it again.
 */
internal class GenerateStamp(private val file: Path) {
    /** Whether the last run had [inputsHash] and left the [roots], directories or files, as they are now. */
    fun isCurrent(inputsHash: String, roots: List<Path>): Boolean {
        if (!file.exists()) return false

        val recorded = file.readLines().associate { line -> line.substringBefore('=') to line.substringAfter('=') }

        return recorded[INPUTS] == inputsHash && recorded[OUTPUTS] == treesHash(roots)
    }

    fun record(inputsHash: String, roots: List<Path>) {
        file.createParentDirectories().writeText("$INPUTS=$inputsHash\n$OUTPUTS=${treesHash(roots)}\n")
    }

    /** A fingerprint of every input of a run, each given as a named part, in order. */
    class Inputs {
        private val digest = MessageDigest.getInstance(SHA_256)

        fun text(name: String, value: String?) {
            digest.update("$name=${value ?: NONE}\n".toByteArray())
        }

        /** Every file under each of [directories], by its path relative to that directory and its bytes. */
        fun trees(name: String, directories: List<Path>) {
            text(name, treesHash(directories))
        }

        /**
         * The plugin's own code: each jar by its coordinates, and by its bytes when its version is a snapshot or the
         * unpublished `0.0.0`, which a new local install replaces under the same coordinates.
         */
        fun code(name: String, artefacts: List<CodeArtefact>) {
            for (artefact in artefacts.sortedBy { it.coordinates }) {
                text(name, artefact.coordinates)
                if (artefact.isUnpublished) text(name, fileHash(artefact))
            }
        }

        private fun fileHash(artefact: CodeArtefact): String {
            val file = artefact.file
                ?: error("Maven resolved no file for the plugin artefact ${artefact.coordinates}; the stamp cannot tell its build.")

            return HexFormat.of().formatHex(MessageDigest.getInstance(SHA_256).digest(Files.readAllBytes(file)))
        }

        fun hash(): String = HexFormat.of().formatHex(digest.digest())
    }

    /** One jar of the plugin's classpath: `group:artifact:version`, and its file once resolved. */
    data class CodeArtefact(val coordinates: String, val isSnapshot: Boolean, val file: Path?) {
        val isUnpublished: Boolean get() = isSnapshot || coordinates.substringAfterLast(':') == UNPUBLISHED_VERSION
    }

    private companion object {
        const val INPUTS = "inputs"
        const val OUTPUTS = "outputs"
        const val SHA_256 = "SHA-256"
        const val NONE = "<none>"
        const val UNPUBLISHED_VERSION = "0.0.0"
        const val LOOP = "<symbolic link loop>"
        const val PRESENT_FILE = "<file>\n"

        fun treesHash(directories: List<Path>): String {
            val digest = MessageDigest.getInstance(SHA_256)
            for (directory in directories) {
                digest.update("${directory.toAbsolutePath().normalize()}\n".toByteArray())
                // An output given as a file (a listed OpenAPI document) counts by its bytes.
                if (Files.isRegularFile(directory)) {
                    digest.update(PRESENT_FILE.toByteArray())
                    digest.update(Files.readAllBytes(directory))
                }
                if (!directory.isDirectory()) continue

                val entries = TreeEntries(directory).also { Files.walkFileTree(directory, setOf(FileVisitOption.FOLLOW_LINKS), Int.MAX_VALUE, it) }
                for ((relative, loop) in entries.found.toSortedMap()) {
                    digest.update("$relative\n".toByteArray())
                    if (loop) digest.update(LOOP.toByteArray()) else digest.update(Files.readAllBytes(directory.resolve(relative)))
                }
            }

            return HexFormat.of().formatHex(digest.digest())
        }
    }

    // Every file under a directory, reached through symbolic links as the compiler reads a `path` source; a link back
    // into a directory being walked is recorded by its path, once, instead of walked again.
    private class TreeEntries(private val root: Path) : SimpleFileVisitor<Path>() {
        val found = mutableMapOf<String, Boolean>()

        override fun visitFile(file: Path, attributes: BasicFileAttributes): FileVisitResult {
            if (attributes.isRegularFile) found[relative(file)] = false

            return FileVisitResult.CONTINUE
        }

        override fun visitFileFailed(file: Path, exception: IOException): FileVisitResult {
            if (exception !is FileSystemLoopException) throw exception
            found[relative(file)] = true

            return FileVisitResult.CONTINUE
        }

        private fun relative(file: Path): String = root.relativize(file).joinToString("/")
    }
}
