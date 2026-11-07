package io.github.jubasse.seampact.maven

import io.github.jubasse.seampact.ir.binary.BinaryPin
import io.github.jubasse.seampact.ir.binary.BinaryPlatform
import io.github.jubasse.seampact.ir.bundle.MavenArtefactResolver
import io.github.jubasse.seampact.ir.bundle.ResolvedArtefact
import io.github.jubasse.seampact.runner.ArtefactUnresolvedException
import io.github.jubasse.seampact.runner.BUNDLE_ARTEFACT_TYPE
import org.eclipse.aether.RepositorySystem
import org.eclipse.aether.RepositorySystemSession
import org.eclipse.aether.artifact.DefaultArtifact
import org.eclipse.aether.repository.ArtifactRepository
import org.eclipse.aether.repository.LocalRepository
import org.eclipse.aether.repository.RemoteRepository
import org.eclipse.aether.resolution.ArtifactRequest
import org.eclipse.aether.resolution.ArtifactResolutionException
import java.io.IOException
import java.nio.file.Path

/**
 * Resolves the `maven` bundle sources and the pinned compiler binary through Resolver, with the project's remote
 * repositories, so `settings.xml` mirrors, proxies and `-o` apply (ADR 0010 "Resolution"). An artefact served by the
 * local repository (installed there, not downloaded) or by a `file:` repository counts as a local source (ADR 0011).
 */
internal class ResolverArtefacts(
    private val system: RepositorySystem,
    private val session: RepositorySystemSession,
    private val repositories: List<RemoteRepository>,
) : MavenArtefactResolver {
    override fun resolve(coordinates: String): ResolvedArtefact {
        val (groupId, artifactId, version) = coordinates.split(":")
        val resolved = try {
            resolveArtifact(DefaultArtifact(groupId, artifactId, NO_CLASSIFIER, BUNDLE_ARTEFACT_TYPE, version))
        } catch (unresolved: ArtefactUnresolvedException) {
            throw IOException(unresolved.message, unresolved)
        }

        return ResolvedArtefact(resolved.file, isLocal(resolved.repository))
    }

    /** The pinned binary's file; an [ArtefactUnresolvedException] with Resolver's reason when it cannot be resolved. */
    fun resolveBinary(pin: BinaryPin.Artifact): Path =
        resolveArtifact(DefaultArtifact(BinaryPlatform.GROUP_ID, BinaryPlatform.ARTIFACT_ID, pin.platform.classifier, BinaryPlatform.ARTIFACT_TYPE, pin.version)).file

    /** Where each bundle of [coordinates] is served from, `<coordinates> local|remote`: part of the generate stamp. */
    fun origins(coordinates: List<String>): List<String> = coordinates.map { source ->
        val origin = try {
            if (resolve(source).fromLocalRepository) "local" else "remote"
        } catch (unresolved: IOException) {
            // The run itself reports the failure with its source; the stamp only records it.
            "unresolved"
        }
        "$source $origin"
    }

    private class Resolved(val file: Path, val repository: ArtifactRepository?)

    private fun resolveArtifact(artifact: DefaultArtifact): Resolved {
        val result = try {
            system.resolveArtifact(session, ArtifactRequest(artifact, repositories, null))
        } catch (failure: ArtifactResolutionException) {
            throw ArtefactUnresolvedException(failure.message ?: "Resolver gave no reason", failure)
        }

        return Resolved(result.artifact.file.toPath(), result.repository)
    }

    private fun isLocal(repository: ArtifactRepository?): Boolean = when (repository) {
        is LocalRepository -> true
        is RemoteRepository -> repository.url.startsWith(FILE_SCHEME)
        // Resolver names no repository: counted as local, so `allowLocal: false` refuses rather than trusts it.
        else -> true
    }

    private companion object {
        const val NO_CLASSIFIER = ""
        const val FILE_SCHEME = "file:"
    }
}
