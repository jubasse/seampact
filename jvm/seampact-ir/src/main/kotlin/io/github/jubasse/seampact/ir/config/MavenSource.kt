package io.github.jubasse.seampact.ir.config

import kotlinx.serialization.json.JsonObject

// A `maven` source pins one release (ADR 0010): a dynamic version (`+`, `1.+`, `latest.release`, a range) or a
// `-SNAPSHOT` would resolve whatever the repository holds today, and the integrity pin would then fail without
// naming why, so each is refused by name, with the code and text of the Node CLI's `maven-source.ts`.

private const val SNAPSHOT_SUFFIX = "-snapshot"
private const val LATEST_PREFIX = "latest."
private val RANGE_CHARACTERS = Regex("[\\[\\](),]")

internal fun unpinnedMavenProblems(tree: ConfigTree, sources: JsonObject): List<ConfigProblem> =
    sources.mapNotNull { (name, source) ->
        val coordinates = (source as? JsonObject)?.stringAt("maven") ?: return@mapNotNull null
        val version = coordinates.split(":").getOrElse(2) { "" }
        if (!isUnpinnedVersion(version)) return@mapNotNull null

        ConfigProblem(
            "config.source.maven-unpinned",
            "The source '$name' names the Maven version '$version', a dynamic or snapshot version; the integrity pin needs one release.",
            "Name a release version, such as 1.4.0, and pin its integrity.",
            tree.whereOf(listOf("sources", name, "maven")),
        )
    }

private fun isUnpinnedVersion(version: String): Boolean {
    val lower = version.lowercase()

    return lower.endsWith("+") || lower.startsWith(LATEST_PREFIX) || lower.endsWith(SNAPSHOT_SUFFIX) || RANGE_CHARACTERS.containsMatchIn(version)
}
