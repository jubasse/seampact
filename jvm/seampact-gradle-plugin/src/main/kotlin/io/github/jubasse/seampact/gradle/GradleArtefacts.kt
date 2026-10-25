package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.ir.bundle.MavenArtefactResolver
import io.github.jubasse.seampact.ir.bundle.ResolvedArtefact
import io.github.jubasse.seampact.runner.ArtefactUnresolvedException
import io.github.jubasse.seampact.runner.BUNDLE_ARTEFACT_TYPE
import org.gradle.api.artifacts.component.ModuleComponentIdentifier
import org.gradle.api.artifacts.result.ResolvedComponentResult
import org.gradle.api.artifacts.result.ResolvedDependencyResult
import org.gradle.api.file.FileCollection
import java.io.IOException
import java.nio.file.Path

/** The dependency notation of the bundle artefact at [coordinates], `groupId:artifactId:version`. */
internal fun bundleArtefactNotation(coordinates: String): String = "$coordinates@$BUNDLE_ARTEFACT_TYPE"

/**
 * Resolves the `maven` bundle sources through the build's own repositories: [bundleFiles] is the detached
 * configuration of every one of them, resolved on the first call. An artefact Gradle took from a remote repository
 * lies in one of its module caches ([moduleCacheRoots]); Gradle uses a `mavenLocal()` or `file:` repository's files in
 * place, so any other location is a local repository, which counts as a local source (ADR 0011).
 */
internal class GradleBundleArtefacts(
    private val bundleFiles: FileCollection,
    private val moduleCacheRoots: List<Path>,
) : MavenArtefactResolver {
    private val files: Set<Path> by lazy {
        try {
            bundleFiles.files.map { it.toPath().toAbsolutePath().normalize() }.toSet()
        } catch (failure: RuntimeException) {
            throw IOException(failureText(failure), failure)
        }
    }

    override fun resolve(coordinates: String): ResolvedArtefact {
        val (_, artifactId, version) = coordinates.split(":")
        val fileName = "$artifactId-$version.$BUNDLE_ARTEFACT_TYPE"
        val matching = files.filter { it.fileName.toString() == fileName }
        val file = matching.singleOrNull()
            ?: throw IOException("the build resolved ${matching.size} files named $fileName for ${bundleArtefactNotation(coordinates)}")

        return ResolvedArtefact(file, fromLocalRepository = isFromLocalRepository(file, moduleCacheRoots))
    }
}

/** Whether Gradle took [file] from a local repository: it lies outside each of Gradle's module caches. */
internal fun isFromLocalRepository(file: Path, moduleCacheRoots: List<Path>): Boolean {
    val normalized = file.toAbsolutePath().normalize()

    return moduleCacheRoots.none { normalized.startsWith(it.toAbsolutePath().normalize()) }
}

/** The task input that tells where each resolved bundle came from: `<file name> local` or `<file name> remote`. */
internal fun bundleOrigins(files: Set<Path>, moduleCacheRoots: List<Path>): List<String> =
    files.map { "${it.fileName} ${if (isFromLocalRepository(it, moduleCacheRoots)) "local" else "remote"}" }.sorted()

/** The binary artefact's one file, resolved by the build. */
internal fun resolvedSingleFile(files: FileCollection): Path = try {
    files.singleFile.toPath()
} catch (failure: RuntimeException) {
    throw ArtefactUnresolvedException(failureText(failure), failure)
}

// Gradle's resolution failure names the repositories it searched in its causes.
private fun failureText(failure: Throwable): String =
    generateSequence(failure) { it.cause }.mapNotNull { it.message }.distinct().joinToString(": ")

private const val SPRING_BOOT_GROUP = "org.springframework.boot"
private const val SPRING_BOOT_MODULE = "spring-boot"

/** The version of `org.springframework.boot:spring-boot` in the resolved graph of [root], or null without one. */
internal fun springBootVersionIn(root: ResolvedComponentResult): String? {
    val seen = mutableSetOf<ResolvedComponentResult>()
    val pending = ArrayDeque(listOf(root))

    while (pending.isNotEmpty()) {
        val component = pending.removeFirst()
        if (!seen.add(component)) continue

        val id = component.id
        if (id is ModuleComponentIdentifier && id.group == SPRING_BOOT_GROUP && id.module == SPRING_BOOT_MODULE) return id.version

        component.dependencies.filterIsInstance<ResolvedDependencyResult>().forEach { pending += it.selected }
    }

    return null
}
