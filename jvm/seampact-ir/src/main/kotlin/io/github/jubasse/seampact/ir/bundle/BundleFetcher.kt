package io.github.jubasse.seampact.ir.bundle

import io.github.jubasse.seampact.ir.config.LocalSourcePolicy
import java.io.IOException
import java.net.http.HttpClient
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration

/**
 * A Maven artefact the build resolved: its local [file], and whether it came from a local repository
 * (`mavenLocal()`, a `file:` repository), which counts as a local source (ADR 0011).
 */
public data class ResolvedArtefact(val file: Path, val fromLocalRepository: Boolean)

/** Resolves a Maven artefact through the build's own repositories to its local file (the plugin's resolver). */
public fun interface MavenArtefactResolver {
    /** The file of [coordinates], `groupId:artifactId:version`; an [IOException] when it cannot be resolved. */
    @Throws(IOException::class)
    public fun resolve(coordinates: String): ResolvedArtefact
}

/**
 * A bundle source fetched from its channel and put through the pinned-bundle check, so its IR is read with no
 * compiler run (ADR 0011, as the Node runner's `fetch.ts`): a release asset over HTTPS, a git tag with the system
 * `git`, or a Maven artefact the build resolves through [mavenArtefacts] (ADR 0010). A fetched bundle is cached by its pinned
 * integrity under [cacheDirectory] once it passed, and the check runs again on every cache read. A `package`
 * source is the Node runner's: it is refused by name, since no JVM consumer needs the npm registry yet.
 */
public class BundleFetcher(
    private val cacheDirectory: Path,
    private val environment: Map<String, String>,
    private val mavenArtefacts: MavenArtefactResolver,
    private val httpClient: HttpClient = releaseHttpClient(),
    private val releaseDeadline: Duration = DOWNLOAD_DEADLINE,
) {
    private val cache = BundleCache(cacheDirectory)

    /**
     * Fetches and checks [source]; [baseDirectory] is where a local git path is relative to, and [localSources]
     * whether a local git repository may be fetched.
     */
    public fun fetch(source: BundleSource, baseDirectory: Path, localSources: LocalSourcePolicy): BundleVerifyResult {
        val problem = when (source) {
            is BundleSource.Package -> packageUnsupported(source)
            is BundleSource.Release -> releaseSourceProblem(source)
            is BundleSource.Git -> gitSourceProblem(source, localSources)
            is BundleSource.MavenArtefact -> null
        }
        if (problem != null) return refused(problem)

        // The channel only tells an npm package root apart; a Maven artefact is a tarball, checked as a release one.
        // Under refused local sources a Maven artefact is resolved before any cache read, so one that comes from a
        // local repository is refused even when its bundle is cached, as a local git repository is.
        val artefact = if (source is BundleSource.MavenArtefact && localSources == LocalSourcePolicy.REFUSE) {
            when (val resolved = resolveArtefact(source)) {
                is ArtefactResolution.Failed -> return refused(resolved.failure)
                is ArtefactResolution.Resolved -> resolved.artefact
            }
        } else {
            null
        }
        if (source is BundleSource.MavenArtefact && artefact?.fromLocalRepository == true) return refused(localArtefact(source, artefact))

        val channel = if (source is BundleSource.Git) BundleChannel.GIT else BundleChannel.RELEASE
        val entry = source.integrity?.let(cache::entryOf)
        if (entry != null && Files.exists(entry)) return readCacheEntry(entry, source.integrity, channel)

        val fetched = when (source) {
            is BundleSource.Release -> fetchRelease(source)
            is BundleSource.Git -> fetchGitBundle(source, baseDirectory, localSources, environment)
            is BundleSource.MavenArtefact -> extractArtefact(source, artefact)
            is BundleSource.Package -> return refused(packageUnsupported(source))
        }

        return when (fetched) {
            is Fetched.Failed -> refused(fetched.failure)
            is Fetched.Directory -> try {
                val verified = BundleVerifier.verify(fetched.directory, source.integrity, channel)
                if (verified is BundleVerifyResult.Verified && entry != null) cache.store(fetched.directory, entry)
                verified
            } finally {
                fetched.temporary.toFile().deleteRecursively()
            }
        }
    }

    private fun fetchRelease(source: BundleSource.Release): Fetched = when (val download = downloadReleaseTarball(source, httpClient, releaseDeadline)) {
        is Download.Failed -> Fetched.Failed(download.failure)
        is Download.Bytes -> extracted(download.bytes)
    }

    // The build resolves the artefact through its own repositories; its bytes are checked like a downloaded tarball.
    private fun extractArtefact(source: BundleSource.MavenArtefact, resolvedBefore: ResolvedArtefact?): Fetched {
        val tarball = resolvedBefore?.file ?: when (val resolved = resolveArtefact(source)) {
            is ArtefactResolution.Failed -> return Fetched.Failed(resolved.failure)
            is ArtefactResolution.Resolved -> resolved.artefact.file
        }
        val size = try {
            Files.size(tarball)
        } catch (error: IOException) {
            return Fetched.Failed(artefactUnreadable(source, error))
        }
        if (size > BUNDLE_ARCHIVE_BYTES_MAX) {
            return Fetched.Failed(
                BundleFailure(
                    code = BundleFailureCode.ARCHIVE_TOO_LARGE,
                    message = "The tarball holds $size bytes, over the cap of $BUNDLE_ARCHIVE_BYTES_MAX.",
                    fix = NOT_A_BUNDLE_FIX,
                    expected = BUNDLE_ARCHIVE_BYTES_MAX.toString(),
                    actual = size.toString(),
                ),
            )
        }

        val bytes = try {
            Files.readAllBytes(tarball)
        } catch (error: IOException) {
            return Fetched.Failed(artefactUnreadable(source, error))
        }

        return extracted(bytes)
    }

    private sealed interface ArtefactResolution {
        data class Resolved(val artefact: ResolvedArtefact) : ArtefactResolution

        data class Failed(val failure: BundleFailure) : ArtefactResolution
    }

    private fun resolveArtefact(source: BundleSource.MavenArtefact): ArtefactResolution = try {
        ArtefactResolution.Resolved(mavenArtefacts.resolve(source.coordinates))
    } catch (error: IOException) {
        ArtefactResolution.Failed(artefactUnreadable(source, error))
    }

    private fun extracted(tarball: ByteArray): Fetched = when (val extraction = BundleTarball.extract(tarball)) {
        is BundleArchiveExtraction.Extracted -> Fetched.Directory(extraction.directory, extraction.directory)
        // The archive reader refuses a tarball on its first problem.
        is BundleArchiveExtraction.Refused -> Fetched.Failed(extraction.failures.first())
    }

    // A cache entry is checked again on every read; one whose files fail (steps 1-2) names itself, since only removing
    // it heals it. An IR check failure (step 3) is on bytes that match the pin, so refetching gives the same failure.
    private fun readCacheEntry(entry: Path, integrity: String?, channel: BundleChannel): BundleVerifyResult {
        val verified = BundleVerifier.verify(entry, integrity, channel)
        if (verified !is BundleVerifyResult.Refused) return verified
        if (verified.failures.all { it.code.code.startsWith(IR_CHECK_CODE_PREFIX) }) return verified

        val cacheInvalid = BundleFailure(
            BundleFailureCode.CACHE_INVALID,
            "The cached bundle at $entry fails the pinned-bundle check; it was changed after it was cached.",
            "Remove $entry, then run again to fetch the bundle afresh.",
            entry.toString(),
        )

        return verified.copy(failures = listOf(cacheInvalid) + verified.failures)
    }

    private fun refused(failure: BundleFailure): BundleVerifyResult = BundleVerifyResult.Refused(listOf(failure), null)

    private companion object {
        // The codes of the pinned-bundle check's step 3 (`bundle.ir-version`, `bundle.ir-revision`...).
        const val IR_CHECK_CODE_PREFIX = "bundle.ir-"

        fun packageUnsupported(source: BundleSource.Package): BundleFailure = BundleFailure(
            BundleFailureCode.PACKAGE_UNSUPPORTED,
            "The bundle source ${source.describe()} is an npm package; a JVM build does not read the npm registry yet, it comes once a JVM app needs it.",
            "Use the same bundle as a release asset (`release: { url }`), a git tag (`git: { url, tag, directory }`) or a Maven artefact (`maven`), with the same integrity.",
        )

        fun localArtefact(source: BundleSource.MavenArtefact, artefact: ResolvedArtefact): BundleFailure = BundleFailure(
            BundleFailureCode.SOURCE_LOCAL,
            "The ${source.describe()} resolved from a local repository (${artefact.file}), and local sources are refused here.",
            "Resolve the artefact from a shared repository: remove `mavenLocal()` or the `file:` repository from the build's repositories for this build.",
            source.coordinates,
        )

        fun artefactUnreadable(source: BundleSource.MavenArtefact, error: IOException): BundleFailure = BundleFailure(
            BundleFailureCode.ARTEFACT_UNREADABLE,
            "The ${source.describe()} cannot be resolved or read: ${error.message ?: error.javaClass.simpleName}.",
            "Check that the build's repositories hold the artefact and that it is the bundle tarball, then run again.",
            source.coordinates,
        )
    }
}
