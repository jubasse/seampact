package io.github.jubasse.seampact.ir.bundle

import io.github.jubasse.seampact.ir.model.ContractIR
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.attribute.BasicFileAttributes
import kotlinx.serialization.json.JsonElement

/** How the bundle was fetched: an npm package root may also hold npm's own files (`package.json`, `README*`...). */
public enum class BundleChannel { PACKAGE, RELEASE, GIT }

/** The outcome of the pinned-bundle check. */
public sealed interface BundleVerifyResult {
    /**
     * Every step passed. [irs] holds each api's IR by api name; [irDocuments] the same IR as JSON, for a target that
     * reads it with its own kinds and features (`IrReader.read`).
     */
    public data class Verified(
        val manifest: BundleManifest,
        val integrity: String,
        val irs: Map<String, ContractIR>,
        val irDocuments: Map<String, JsonElement>,
    ) : BundleVerifyResult

    /** The failures of the first step that failed; [integrity] is the recomputed value once step 1 passed. */
    public data class Refused(val failures: List<BundleFailure>, val integrity: String?) : BundleVerifyResult
}

// Files npm adds to or keeps in every package, at the package root (npm's `files` rules).
private const val NPM_PACKAGE_MANIFEST = "package.json"
private val NPM_ALWAYS_INCLUDED = Regex("^(?:readme|license|licence|changelog)(?:[.-].*)?$", RegexOption.IGNORE_CASE)

/**
 * The pinned-bundle check (ADR 0011) on a bundle directory, in order, a step running only when the steps before it
 * pass: (0) the manifest exists and reads; (1) every listed file exists with its size and SHA-256, and no file is
 * unlisted; (2) the integrity recomputed from the list equals the manifest's, then [pinnedIntegrity]; (3) each api's
 * IR is one this reader reads. Every failure names its file or its two values; a missing or differing pin also
 * gives the actual integrity, so pinning is a copy. The codes are those of `verify.ts`, proven on the shared vectors.
 */
public object BundleVerifier {
    public fun verify(directory: Path, pinnedIntegrity: String?, channel: BundleChannel): BundleVerifyResult {
        val walked = when (val walk = walkBundle(directory)) {
            is BundleWalk.Walked -> walk.sizes
            is BundleWalk.Refused -> return refused(walk.failure)
        }

        val manifestSize = walked[BUNDLE_MANIFEST_FILE] ?: return refused(
            BundleFailure(
                BundleFailureCode.MANIFEST_MISSING,
                "The bundle has no '$BUNDLE_MANIFEST_FILE' at its root.",
                "Check that the source names a seampact bundle (`seampact bundle` writes the manifest).",
                BUNDLE_MANIFEST_FILE,
            ),
        )
        if (manifestSize > BUNDLE_MANIFEST_BYTES_MAX) return refused(manifestTooLarge(manifestSize))

        val manifest = when (val read = readBundleManifest(Files.readAllBytes(directory.resolve(BUNDLE_MANIFEST_FILE)))) {
            is ManifestRead.Read -> read.manifest
            is ManifestRead.Refused -> return refused(read.failure)
        }

        val files = when (val checked = checkFiles(directory, manifest, walked, channel)) {
            is FileCheck.Read -> checked.bytesByPath
            is FileCheck.Refused -> return BundleVerifyResult.Refused(checked.failures, null)
        }

        val integrity = bundleIntegrity(manifest.files)
        val integrityFailure = checkIntegrity(manifest, integrity, pinnedIntegrity)
        if (integrityFailure != null) return BundleVerifyResult.Refused(listOf(integrityFailure), integrity)

        return checkIrs(manifest, files, integrity)
    }

    private fun refused(failure: BundleFailure): BundleVerifyResult = BundleVerifyResult.Refused(listOf(failure), null)

    private fun checkIrs(manifest: BundleManifest, files: Map<String, ByteArray>, integrity: String): BundleVerifyResult {
        val irs = LinkedHashMap<String, ContractIR>()
        val documents = LinkedHashMap<String, JsonElement>()
        val failures = mutableListOf<BundleFailure>()

        for (api in manifest.apis) {
            // The manifest rules list every api's file, and step 1 read every listed file.
            val bytes = files[api.file] ?: error("bundle: the checked file '${api.file}' of api '${api.name}' was not read.")
            when (val checked = checkBundleIr(api, bytes)) {
                is BundleIrCheck.Read -> {
                    irs[api.name] = checked.ir
                    documents[api.name] = checked.document
                }
                is BundleIrCheck.Refused -> failures += checked.failure
            }
        }

        if (failures.isNotEmpty()) return BundleVerifyResult.Refused(failures, integrity)

        return BundleVerifyResult.Verified(manifest, integrity, irs, documents)
    }
}

private sealed interface BundleWalk {
    data class Walked(val sizes: Map<String, Long>) : BundleWalk

    data class Refused(val failure: BundleFailure) : BundleWalk
}

// Every regular file under [directory] with its size, by POSIX path; a link or special file, or a bundle over the
// caps, is the failure. Links are never followed.
private fun walkBundle(directory: Path): BundleWalk {
    val sizes = LinkedHashMap<String, Long>()
    val pending = ArrayDeque(listOf(""))
    var total = 0L

    while (pending.isNotEmpty()) {
        val relative = pending.removeLast()
        val entries = Files.newDirectoryStream(if (relative == "") directory else directory.resolve(relative)).use { it.toList() }

        for (entry in entries) {
            val name = entry.fileName.toString()
            val path = if (relative == "") name else "$relative/$name"
            val attributes = Files.readAttributes(entry, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)

            if (attributes.isDirectory) {
                pending.addLast(path)
                continue
            }

            if (!attributes.isRegularFile) {
                return BundleWalk.Refused(
                    BundleFailure(
                        BundleFailureCode.FILE_TYPE,
                        "${quoted(path)} is a link or a special file; a bundle holds regular files only.",
                        REFETCH_FIX,
                        path,
                    ),
                )
            }

            sizes[path] = attributes.size()
            total += attributes.size()
            if (sizes.size > BUNDLE_ENTRIES_MAX || total > BUNDLE_EXTRACTED_BYTES_MAX) {
                return BundleWalk.Refused(overCap(sizes.size, total))
            }
        }
    }

    return BundleWalk.Walked(sizes)
}

private fun overCap(fileCount: Int, total: Long): BundleFailure {
    if (fileCount > BUNDLE_ENTRIES_MAX) {
        return BundleFailure(
            code = BundleFailureCode.TOO_MANY_FILES,
            message = "The bundle holds more than $BUNDLE_ENTRIES_MAX files.",
            fix = NOT_A_BUNDLE_FIX,
            expected = BUNDLE_ENTRIES_MAX.toString(),
        )
    }

    return BundleFailure(
        code = BundleFailureCode.TOO_LARGE,
        message = "The bundle's files hold more than $BUNDLE_EXTRACTED_BYTES_MAX bytes ($total so far).",
        fix = NOT_A_BUNDLE_FIX,
        expected = BUNDLE_EXTRACTED_BYTES_MAX.toString(),
    )
}

private sealed interface FileCheck {
    data class Read(val bytesByPath: Map<String, ByteArray>) : FileCheck

    data class Refused(val failures: List<BundleFailure>) : FileCheck
}

// Step 1: the bytes of every listed file, or every file failure in path order (listed files, then unlisted ones).
private fun checkFiles(
    directory: Path,
    manifest: BundleManifest,
    walked: Map<String, Long>,
    channel: BundleChannel,
): FileCheck {
    val failures = mutableListOf<BundleFailure>()
    val bytesByPath = HashMap<String, ByteArray>()

    for (file in manifest.files) {
        val failure = listedFileFailure(directory, file, walked[file.path], bytesByPath)
        if (failure != null) failures += failure
    }

    val listed = manifest.files.map { it.path }.toSet()
    val unlisted = walked.keys
        .filter { it != BUNDLE_MANIFEST_FILE && it !in listed && !isNpmFile(it, channel) }
        .sortedWith(::compareBundlePaths)

    for (path in unlisted) {
        failures += BundleFailure(
            BundleFailureCode.FILE_UNLISTED,
            "${quoted(path)} is in the bundle and not listed in the manifest.",
            REFETCH_FIX,
            path,
        )
    }

    return if (failures.isEmpty()) FileCheck.Read(bytesByPath) else FileCheck.Refused(failures)
}

// One listed file: missing, of another size or hash, or read into [bytesByPath].
private fun listedFileFailure(directory: Path, file: BundleFile, size: Long?, bytesByPath: MutableMap<String, ByteArray>): BundleFailure? {
    if (size == null) {
        return BundleFailure(
            BundleFailureCode.FILE_MISSING,
            "'${file.path}' is listed in the manifest and missing from the bundle.",
            REFETCH_FIX,
            file.path,
        )
    }

    if (size != file.size) {
        return BundleFailure(
            BundleFailureCode.FILE_SIZE,
            "'${file.path}' holds $size bytes; the manifest lists ${file.size}.",
            REFETCH_FIX,
            file.path,
            file.size.toString(),
            size.toString(),
        )
    }

    val bytes = Files.readAllBytes(file.path.split("/").fold(directory, Path::resolve))
    val sha256 = sha256Hex(bytes)
    if (sha256 != file.sha256) {
        return BundleFailure(
            BundleFailureCode.FILE_HASH,
            "'${file.path}' has the SHA-256 $sha256; the manifest lists ${file.sha256}.",
            REFETCH_FIX,
            file.path,
            file.sha256,
            sha256,
        )
    }

    bytesByPath[file.path] = bytes
    return null
}

private fun isNpmFile(path: String, channel: BundleChannel): Boolean {
    if (channel != BundleChannel.PACKAGE || '/' in path) return false

    return path == NPM_PACKAGE_MANIFEST || NPM_ALWAYS_INCLUDED.matches(path)
}

// Step 2: the manifest's integrity against the recomputed one, then the pin against both.
private fun checkIntegrity(manifest: BundleManifest, integrity: String, pinnedIntegrity: String?): BundleFailure? {
    if (manifest.integrity != integrity) {
        return BundleFailure(
            BundleFailureCode.INTEGRITY_MISMATCH,
            "The manifest's integrity is ${manifest.integrity}; its file list gives $integrity.",
            REFETCH_FIX,
            BUNDLE_MANIFEST_FILE,
            manifest.integrity,
            integrity,
        )
    }

    if (pinnedIntegrity == null) {
        return BundleFailure(
            code = BundleFailureCode.PIN_MISSING,
            message = "The bundle source pins no integrity; the bundle's is $integrity.",
            fix = "Review the bundle, then pin it: integrity: $integrity",
            actual = integrity,
        )
    }

    if (pinnedIntegrity != integrity) {
        return BundleFailure(
            code = BundleFailureCode.PIN_MISMATCH,
            message = "The pinned integrity is $pinnedIntegrity; the bundle's is $integrity.",
            fix = "Fetch the bundle the pin names, or review this one and pin it: integrity: $integrity",
            expected = pinnedIntegrity,
            actual = integrity,
        )
    }

    return null
}
