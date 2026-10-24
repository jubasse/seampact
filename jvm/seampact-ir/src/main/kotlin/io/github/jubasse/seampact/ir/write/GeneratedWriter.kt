package io.github.jubasse.seampact.ir.write

import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.security.MessageDigest
import java.util.HexFormat

/** What the writer does with a generated file edited by hand since it was written: refuse the write, or write over it. */
public enum class HandEditPolicy { REFUSE, OVERWRITE }

/** A write whose checks all passed, not yet done: what [GeneratedWriter.commit] writes, keeps and removes. */
public class PlannedWrite internal constructor(
    public val rootDir: Path,
    public val owner: String,
    internal val files: List<PlannedFile>,
    public val unchanged: List<String>,
    public val removable: List<String>,
) {
    /** The paths a commit writes: each planned file whose bytes differ from the file on disk, or that is missing. */
    public val changed: List<String> get() = files.map { it.path }.filter { it !in unchanged }
}

internal class PlannedFile(val path: String, val bytes: ByteArray, val sha256: String)

/** The outcome of planning a write. */
public sealed interface PlanOutcome {
    public data class Planned(val write: PlannedWrite) : PlanOutcome

    public data class Refused(val refusals: List<WriterRefusal>) : PlanOutcome
}

/** The paths a committed write wrote, left unchanged and removed. */
public data class WrittenFiles(val written: List<String>, val unchanged: List<String>, val removed: List<String>)

private const val BYTE_ORDER_MARK = "﻿"
// Each runner names its own way to generate again; no JVM runner overwrites a hand edit.
private const val HAND_EDIT_FIX =
    "Move the hand-written code next to the generated files, then delete the edited file and generate again."

/**
 * Writes a target's files into its output directory (ADR 0015 "Writing files"), as the Node writer
 * (`codegen-core/src/writer.ts`) does, with its codes: UTF-8 without a byte-order mark, LF line endings and a final
 * newline, only inside the output directory, with `.seampact-manifest.json` listing each file and its SHA-256.
 * Files a previous run generated and this one does not are removed. Every check runs before the first write: a
 * manifest that is not a regular file or belongs to another target, a file the writer did not generate, a
 * hand-edited one (unless [HandEditPolicy.OVERWRITE], the `--force` semantics) or a path leaving the directory
 * refuses the whole write, naming the file and the fix.
 */
public object GeneratedWriter {
    /** Plans then commits the write of [files] into [outDir] for the target entry [owner]. */
    public fun write(outDir: Path, owner: String, files: List<GeneratedFile>, onHandEdit: HandEditPolicy): PlanOutcome {
        val planned = plan(outDir, owner, files, onHandEdit)
        if (planned is PlanOutcome.Planned) commit(planned.write)

        return planned
    }

    /** Every check of [write], with nothing written, so a caller writing several directories checks them all first. */
    public fun plan(outDir: Path, owner: String, files: List<GeneratedFile>, onHandEdit: HandEditPolicy): PlanOutcome {
        val (checked, pathRefusals) = checkGeneratedPaths(files)
        if (pathRefusals.isNotEmpty()) return PlanOutcome.Refused(pathRefusals)

        val rootDir = realPathOfMissing(outDir.toAbsolutePath().normalize())
        val manifestPath = rootDir.resolve(MANIFEST_FILE_NAME)
        if (Files.exists(manifestPath, LinkOption.NOFOLLOW_LINKS) && !Files.isRegularFile(manifestPath, LinkOption.NOFOLLOW_LINKS)) {
            return refused(
                "writer.manifest.not-regular",
                "The manifest $manifestPath is not a regular file, so the writer does not read or write it.",
                "Delete $manifestPath, then generate again.",
            )
        }

        val manifest = when (val read = readManifest(rootDir)) {
            is ManifestRead.Read -> read
            is ManifestRead.Invalid -> return refused(
                "writer.manifest.invalid",
                "The manifest $manifestPath cannot be read: ${read.reason}.",
                "Delete the generated files of this target and its manifest, then generate again.",
            )
        }

        if (manifest.owner != null && manifest.owner != owner) {
            return refused(
                "writer.manifest.other-owner",
                "The output directory $rootDir belongs to the target '${manifest.owner}', not '$owner'.",
                "Give '$owner' its own `out` directory, or delete $manifestPath and the files of '${manifest.owner}'.",
            )
        }

        return planFiles(rootDir, owner, checked.map(::plannedFile), manifest.hashByPath, onHandEdit)
    }

    /** Writes a planned write: the changed files, the removal of the stale ones, then the manifest. */
    public fun commit(write: PlannedWrite): WrittenFiles {
        Files.createDirectories(write.rootDir)

        val unchanged = write.unchanged.toSet()
        val toWrite = write.files.filter { it.path !in unchanged }
        for (file in toWrite) {
            val target = write.rootDir.resolve(file.path)
            Files.createDirectories(target.parent)
            Files.write(target, file.bytes)
        }

        for (path in write.removable) {
            val target = write.rootDir.resolve(path)
            Files.delete(target)
            removeEmptyDirectories(write.rootDir, target.parent)
        }

        val hashByPath = write.files.associate { it.path to it.sha256 }
        Files.writeString(write.rootDir.resolve(MANIFEST_FILE_NAME), serializeManifest(write.owner, hashByPath))

        return WrittenFiles(toWrite.map { it.path }, write.unchanged, write.removable)
    }

    private fun planFiles(
        rootDir: Path,
        owner: String,
        planned: List<PlannedFile>,
        recorded: Map<String, String>,
        onHandEdit: HandEditPolicy,
    ): PlanOutcome {
        val produced = planned.map { it.path }.toSet()
        val refusals = mutableListOf<WriterRefusal>()
        val unchanged = mutableListOf<String>()
        val removable = mutableListOf<String>()

        for (file in planned) {
            when (val state = existingFileState(rootDir, file.path, recorded[file.path], onHandEdit)) {
                is FileState.Refused -> refusals += state.refusal
                is FileState.Generated -> if (state.sha256 == file.sha256) unchanged += file.path
                FileState.Absent -> Unit
            }
        }

        for (path in recorded.keys.filter { it !in produced }) {
            when (val state = existingFileState(rootDir, path, recorded[path], onHandEdit)) {
                is FileState.Refused -> refusals += state.refusal
                is FileState.Generated -> removable += path
                FileState.Absent -> Unit
            }
        }

        if (refusals.isNotEmpty()) return PlanOutcome.Refused(refusals)

        return PlanOutcome.Planned(PlannedWrite(rootDir, owner, planned, unchanged, removable))
    }

    private fun refused(code: String, message: String, fix: String): PlanOutcome =
        PlanOutcome.Refused(listOf(WriterRefusal(code, message, fix)))
}

private fun plannedFile(file: GeneratedFile): PlannedFile {
    val lineFeeds = file.contents.removePrefix(BYTE_ORDER_MARK).replace(Regex("\r\n?"), "\n")
    val text = if (lineFeeds.endsWith("\n")) lineFeeds else "$lineFeeds\n"
    val bytes = text.toByteArray(Charsets.UTF_8)

    return PlannedFile(file.path, bytes, sha256Of(bytes))
}

private sealed interface FileState {
    data object Absent : FileState

    data class Generated(val sha256: String) : FileState

    data class Refused(val refusal: WriterRefusal) : FileState
}

// What is at [path] now: nothing, the file the manifest recorded, or something the writer must not touch.
private fun existingFileState(rootDir: Path, path: String, recordedSha256: String?, onHandEdit: HandEditPolicy): FileState {
    val file = path.split("/").fold(rootDir, Path::resolve)

    if (leavesRoot(rootDir, file)) {
        return refusedState(
            "writer.path.outside",
            "'$file' resolves outside the output directory $rootDir through a symbolic link.",
            "Replace the symbolic link in the output directory with a plain directory.",
        )
    }

    if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) return FileState.Absent

    if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
        return refusedState(
            "writer.file.not-generated",
            "'$file' is not a regular file, so the writer did not generate it.",
            "Move it out of the output directory $rootDir.",
        )
    }

    if (recordedSha256 == null) {
        return refusedState(
            "writer.file.not-generated",
            "'$file' exists and the writer did not generate it, so it is not overwritten.",
            "Move it out of the output directory $rootDir, or rename it.",
        )
    }

    val sha256 = sha256Of(Files.readAllBytes(file))
    if (sha256 != recordedSha256 && onHandEdit == HandEditPolicy.REFUSE) {
        return refusedState(
            "writer.file.edited",
            "'$file' was edited by hand since it was generated, so it is not overwritten or removed.",
            HAND_EDIT_FIX,
        )
    }

    return FileState.Generated(sha256)
}

private fun refusedState(code: String, message: String, fix: String): FileState = FileState.Refused(WriterRefusal(code, message, fix))

// The real path [directory] has or will have once created: its deepest existing ancestor's real path, then the rest.
private fun realPathOfMissing(directory: Path): Path {
    if (Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) return directory.toRealPath()

    val parent = directory.parent ?: return directory

    return realPathOfMissing(parent).resolve(directory.fileName.toString())
}

// True when the deepest existing directory above [file] is, once symbolic links resolve, outside [rootDir].
private fun leavesRoot(rootDir: Path, file: Path): Boolean {
    var directory = file.parent
    while (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) {
        // The output directory itself is not created yet, so nothing below it is a link.
        if (directory == rootDir) return false
        directory = directory.parent
    }

    return !directory.toRealPath().startsWith(rootDir)
}

private fun removeEmptyDirectories(rootDir: Path, directory: Path) {
    if (directory == rootDir || !directory.startsWith(rootDir)) return

    val isEmpty = Files.newDirectoryStream(directory).use { !it.iterator().hasNext() }
    if (!isEmpty) return

    Files.delete(directory)
    removeEmptyDirectories(rootDir, directory.parent)
}

private fun sha256Of(bytes: ByteArray): String = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))
