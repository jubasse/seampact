package io.github.jubasse.seampact.ir.bundle

import io.github.jubasse.seampact.ir.config.LocalSourcePolicy
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.util.concurrent.TimeUnit

// The git-tag channel, as `fetch-git.ts`: a shallow fetch of the tag with the system `git` into a new bare
// repository, then the files of the tag's tree read with `git ls-tree` and `git cat-file`, never through a work
// tree, so `autocrlf`, attributes, smudge filters and LFS cannot change a byte. Only `https:` and `ssh`
// repositories are fetched, plus local ones (`file:` or a path) when local sources are allowed; `ext::` is off. The
// tree is untrusted: a link, a submodule, an unportable path or a case-fold duplicate is refused before anything
// is written. Every command names the temporary repository by `--git-dir` and drops the variables that locate a
// repository, so a run from a git hook (which exports `GIT_DIR`) never touches the user's repository.

private const val GIT = "git"
private const val TEMPORARY_PREFIX = "seampact-git-"
private const val REPOSITORY = "repository"
private const val FILES = "files"
private const val FETCHED = "FETCH_HEAD"
private val REGULAR_FILE_MODES = setOf("100644", "100755")
private val URL_SCHEME = Regex("^([A-Za-z][A-Za-z0-9+.-]*)://")
private val DRIVE_PATH = Regex("^[A-Za-z]:[\\\\/]")

// `[user@]host:path`, git's scp-like ssh form: a colon before any slash, after a host longer than a drive letter.
private val SCP_LIKE = Regex("^[^/:]{2,}:")
private const val REMOTE_PROTOCOLS = "https:ssh"
private const val LOCAL_PROTOCOL = "file"
private const val FETCH_TIMEOUT_SECONDS = 60L

// ssh would otherwise ask for a host key or a passphrase on the terminal, which `GIT_TERMINAL_PROMPT` does not cover.
private const val NON_INTERACTIVE_SSH = "ssh -o BatchMode=yes"
private val REPOSITORY_LOCATING_VARIABLES = listOf(
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_NAMESPACE",
    "GIT_QUARANTINE_PATH",
)

internal sealed interface Fetched {
    /** The bundle directory, inside [temporary], which the caller removes. */
    data class Directory(val directory: Path, val temporary: Path) : Fetched

    data class Failed(val failure: BundleFailure) : Fetched
}

/** Why the source cannot be fetched before any git command runs: its URL, its tag, its directory. */
internal fun gitSourceProblem(source: BundleSource.Git, localSources: LocalSourcePolicy): BundleFailure? {
    val url = source.url
    val scheme = URL_SCHEME.find(url)?.groupValues?.get(1)?.lowercase()

    if (scheme != null && scheme !in listOf("https", "ssh", LOCAL_PROTOCOL)) {
        return BundleFailure(
            BundleFailureCode.GIT_URL,
            "The git URL ${quoted(printableUrl(url))} uses '$scheme:'; a bundle is fetched over https: or ssh only.",
            "Name the repository by its https: or ssh URL.",
        )
    }

    if (isLocalRepository(url) && localSources == LocalSourcePolicy.REFUSE) {
        return BundleFailure(
            BundleFailureCode.SOURCE_LOCAL,
            "The git repository ${quoted(printableUrl(url))} is local, and local sources are refused here.",
            "Name the repository by its https: or ssh URL.",
        )
    }

    if (bundleDirectoryPrefix(source.directory) == null) {
        return BundleFailure(
            BundleFailureCode.GIT_DIRECTORY,
            "The git directory ${quoted(source.directory ?: "")} is not a relative path inside the repository.",
            "Name the bundle directory relative to the repository root, without '.', '..' or a backslash.",
        )
    }

    if (source.tag.startsWith("-") || ".." in source.tag) {
        return BundleFailure(BundleFailureCode.GIT_TAG, "The git tag ${quoted(source.tag)} is not a tag name.", "Name the tag the bundle was committed under.")
    }

    return null
}

/** The bundle directory of the tag's tree, written into a new temporary directory the caller removes. */
internal fun fetchGitBundle(
    source: BundleSource.Git,
    baseDirectory: Path,
    localSources: LocalSourcePolicy,
    environment: Map<String, String>,
): Fetched {
    val problem = gitSourceProblem(source, localSources)
    if (problem != null) return Fetched.Failed(problem)

    val prefix = bundleDirectoryPrefix(source.directory) ?: ""
    val temporary = Files.createTempDirectory(TEMPORARY_PREFIX)
    val git = GitRunner(temporary.resolve(REPOSITORY), gitEnvironment(environment, localSources))

    try {
        git.run(listOf("init", "--quiet", "--bare"))
        git.run(listOf("fetch", "--quiet", "--depth", "1", "--no-tags", "--", repositoryUrl(source.url, baseDirectory), "refs/tags/${source.tag}"))

        val failure = writeTree(git, prefix, temporary.resolve(FILES))
        if (failure != null) {
            temporary.toFile().deleteRecursively()
            return Fetched.Failed(failure)
        }
    } catch (error: GitFailedException) {
        temporary.toFile().deleteRecursively()
        return Fetched.Failed(
            BundleFailure(
                BundleFailureCode.GIT_FAILED,
                "Fetching tag '${source.tag}' of ${quoted(printableUrl(source.url))} with git failed: ${quoted(error.reason)}.",
                "Check the URL, the tag and your access to the repository, and that `git` is on the PATH.",
            ),
        )
    }

    return Fetched.Directory(temporary.resolve(FILES), temporary)
}

private fun isLocalRepository(url: String): Boolean {
    val scheme = URL_SCHEME.find(url)?.groupValues?.get(1)?.lowercase()
    if (scheme != null) return scheme == LOCAL_PROTOCOL

    return DRIVE_PATH.containsMatchIn(url) || !SCP_LIKE.containsMatchIn(url)
}

// A local path as a `file:` URL, relative to the base directory; any other URL as written.
private fun repositoryUrl(url: String, baseDirectory: Path): String {
    if (!isLocalRepository(url) || URL_SCHEME.containsMatchIn(url)) return url

    return baseDirectory.resolve(url).toAbsolutePath().normalize().toUri().toString()
}

// [directory] as a tree path prefix (`""` for the root, else `a/b/`), or null when it is not a plain relative path.
private fun bundleDirectoryPrefix(directory: String?): String? {
    if (directory == null) return ""

    val segments = directory.trimEnd('/').split("/")
    val isPlain = segments.all { it != "" && it != "." && it != ".." && '\\' !in it }

    return if (isPlain) "${segments.joinToString("/")}/" else null
}

// The user's environment, less every variable that would point git at another repository.
private fun gitEnvironment(inherited: Map<String, String>, localSources: LocalSourcePolicy): Map<String, String> =
    inherited.filterKeys { it !in REPOSITORY_LOCATING_VARIABLES } + mapOf(
        "GIT_ALLOW_PROTOCOL" to if (localSources == LocalSourcePolicy.ALLOW) "$REMOTE_PROTOCOLS:$LOCAL_PROTOCOL" else REMOTE_PROTOCOLS,
        "GIT_TERMINAL_PROMPT" to "0",
        "GIT_SSH_COMMAND" to (inherited["GIT_SSH_COMMAND"] ?: NON_INTERACTIVE_SSH),
    )

private class GitFailedException(val reason: String) : Exception(reason)

private class GitRunner(private val repository: Path, private val environment: Map<String, String>) {
    fun run(arguments: List<String>): ByteArray {
        val command = listOf(GIT, "-c", "protocol.ext.allow=never", "--git-dir=$repository") + arguments
        val builder = ProcessBuilder(command).redirectInput(ProcessBuilder.Redirect.from(nullDevice()))
        builder.environment().clear()
        builder.environment().putAll(environment)

        val process = try {
            builder.start()
        } catch (error: IOException) {
            throw GitFailedException(error.message ?: "git could not start")
        }

        val errors = ByteArrayOutputStream()
        val errorReader = Thread { process.errorStream.use { it.transferTo(errors) } }.apply { start() }
        val output = CappedOutput()
        val outputReader = Thread { process.inputStream.use { output.copyFrom(it) } }.apply { start() }

        if (!process.waitFor(FETCH_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            process.destroyForcibly()
            throw GitFailedException("it took over ${FETCH_TIMEOUT_SECONDS * 1000} ms")
        }
        outputReader.join()
        errorReader.join()

        if (process.exitValue() != 0) throw GitFailedException(errors.toString(Charsets.UTF_8).trim())
        if (output.overflowed) throw GitFailedException("it wrote more than $BUNDLE_EXTRACTED_BYTES_MAX bytes")

        return output.bytes.toByteArray()
    }

    private fun nullDevice(): File = File(if (System.getProperty("os.name").startsWith("Windows")) "NUL" else "/dev/null")
}

// A command's output up to the extracted-bundle cap; the rest is drained, and the overflow refuses the command.
private class CappedOutput {
    val bytes = ByteArrayOutputStream()
    var overflowed = false
        private set

    fun copyFrom(input: InputStream) {
        val chunk = ByteArray(COPY_CHUNK_BYTES)
        while (true) {
            val read = input.read(chunk)
            if (read == -1) return

            if (bytes.size() + read > BUNDLE_EXTRACTED_BYTES_MAX) overflowed = true
            if (!overflowed) bytes.write(chunk, 0, read)
        }
    }
}

private const val COPY_CHUNK_BYTES = 64 * 1024

private data class TreeFile(val path: String, val objectId: String)

// Reads the tree below [prefix] and writes its files under [target], or the failure refusing it.
private fun writeTree(git: GitRunner, prefix: String, target: Path): BundleFailure? {
    val listing = git.run(listOf("ls-tree", "-r", "-z", "--full-tree", FETCHED)).toString(Charsets.UTF_8)
    val files = when (val listed = treeFiles(listing, prefix)) {
        is TreeListing.Files -> listed.files
        is TreeListing.Refused -> return listed.failure
    }

    Files.createDirectories(target)
    var total = 0L

    for (file in files) {
        val bytes = git.run(listOf("cat-file", "blob", file.objectId))
        total += bytes.size
        if (total > BUNDLE_EXTRACTED_BYTES_MAX) {
            return BundleFailure(
                code = BundleFailureCode.ARCHIVE_EXTRACTED_TOO_LARGE,
                message = "The tag's bundle files hold more than $BUNDLE_EXTRACTED_BYTES_MAX bytes.",
                fix = NOT_A_BUNDLE_FIX,
                expected = BUNDLE_EXTRACTED_BYTES_MAX.toString(),
            )
        }

        val path = file.path.split("/").fold(target, Path::resolve)
        Files.createDirectories(path.parent)
        Files.write(path, bytes, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
    }

    return null
}

private sealed interface TreeListing {
    data class Files(val files: List<TreeFile>) : TreeListing

    data class Refused(val failure: BundleFailure) : TreeListing
}

// The listing's entries below [prefix], each checked as the archive reader checks a tarball entry.
private fun treeFiles(listing: String, prefix: String): TreeListing {
    val files = mutableListOf<TreeFile>()
    val folded = HashSet<String>()

    for (line in listing.split('\u0000')) {
        if (line.isEmpty()) continue

        val tab = line.indexOf('\t')
        val (mode, type, objectId) = line.substring(0, tab).split(" ").plus(listOf("", "", "")).take(3)
        val fullPath = line.substring(tab + 1)
        if (!fullPath.startsWith(prefix)) continue

        val path = fullPath.removePrefix(prefix)
        val failure = treeEntryFailure(path, mode, type, folded)
        if (failure != null) return TreeListing.Refused(failure)

        folded += bundlePathFold(path)
        files += TreeFile(path, objectId)

        if (files.size > BUNDLE_ENTRIES_MAX) {
            return TreeListing.Refused(
                BundleFailure(
                    code = BundleFailureCode.ARCHIVE_TOO_MANY_ENTRIES,
                    message = "The tag's bundle directory holds more than $BUNDLE_ENTRIES_MAX files.",
                    fix = NOT_A_BUNDLE_FIX,
                    expected = BUNDLE_ENTRIES_MAX.toString(),
                ),
            )
        }
    }

    return TreeListing.Files(files)
}

private fun treeEntryFailure(path: String, mode: String, type: String, folded: Set<String>): BundleFailure? {
    if (type != "blob" || mode !in REGULAR_FILE_MODES) {
        return BundleFailure(
            BundleFailureCode.ARCHIVE_ENTRY_TYPE,
            "${quoted(path)} is a link or a submodule in the tag's tree; a bundle holds regular files only.",
            "Commit the bundle's files as regular files.",
            path,
        )
    }

    val problem = if (path == BUNDLE_MANIFEST_FILE) null else bundlePathProblem(path)
    if (problem != null) {
        return BundleFailure(
            BundleFailureCode.ARCHIVE_ENTRY_PATH,
            "${quoted(path)} in the tag's tree is not a bundle path: $problem.",
            "Point `directory` at the bundle directory, which holds the manifest, `sources/` and `ir/` only.",
            path,
        )
    }

    if (bundlePathFold(path) in folded) {
        return BundleFailure(
            BundleFailureCode.ARCHIVE_ENTRY_DUPLICATE,
            "${quoted(path)} differs only by letter case from another file of the tag's tree.",
            "Keep one of the two files.",
            path,
        )
    }

    return null
}
