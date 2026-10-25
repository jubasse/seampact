package io.github.jubasse.seampact.maven

import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.HexFormat
import kotlin.io.path.createParentDirectories
import kotlin.io.path.exists
import kotlin.io.path.isDirectory
import kotlin.io.path.readLines
import kotlin.io.path.writeText

/**
 * The record of the last generate run, in the build directory: the hash of its inputs and of the files it left in
 * the entry roots. The goal skips when both are unchanged, as Gradle's up-to-date check does; a file edited, added
 * or removed in an entry root, or any changed input, runs it again.
 */
internal class GenerateStamp(private val file: Path) {
    /** Whether the last run had [inputsHash] and left the entry [roots] as they are now. */
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

        fun treesHash(directories: List<Path>): String {
            val digest = MessageDigest.getInstance(SHA_256)
            for (directory in directories) {
                digest.update("${directory.toAbsolutePath().normalize()}\n".toByteArray())
                if (!directory.isDirectory()) continue

                val files = Files.walk(directory).use { paths -> paths.filter(Files::isRegularFile).map { directory.relativize(it) }.toList() }
                for (relative in files.sortedBy { it.joinToString("/") }) {
                    digest.update("${relative.joinToString("/")}\n".toByteArray())
                    digest.update(Files.readAllBytes(directory.resolve(relative)))
                }
            }

            return HexFormat.of().formatHex(digest.digest())
        }
    }
}
