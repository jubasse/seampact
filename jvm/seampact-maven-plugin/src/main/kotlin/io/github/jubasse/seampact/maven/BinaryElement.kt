package io.github.jubasse.seampact.maven

import io.github.jubasse.seampact.ir.config.ConfigProblem
import io.github.jubasse.seampact.runner.BinarySettings
import org.codehaus.plexus.configuration.PlexusConfiguration
import java.nio.file.Path

internal sealed interface BinaryElementRead {
    data class Read(val settings: BinarySettings) : BinaryElementRead

    data class Refused(val problems: List<ConfigProblem>) : BinaryElementRead
}

/**
 * The `<binary>` element of the plugin's `<configuration>` (ADR 0010 "Pin"): `<version>` with one
 * `<sha256ByClassifier>` child per classifier, or `<path>` (relative to the project) with `<sha256>`. Which
 * combinations pin is the runner's rule, the same as the Gradle `binary { }` block's. Text in place of children, a
 * repeated child, an attribute or an unresolved `${...}` is refused as the app-config keys are.
 */
internal object BinaryElement {
    private const val WHERE = "<configuration>/binary"
    private const val BY_CLASSIFIER = "sha256ByClassifier"
    private val KNOWN = setOf("version", BY_CLASSIFIER, "path", "sha256")

    fun read(binary: PlexusConfiguration?, evaluate: (String) -> String?, appDirectory: Path): BinaryElementRead {
        if (binary == null) return BinaryElementRead.Read(BinarySettings(null, emptyMap(), null, null))

        val reader = Reader(evaluate)
        val children = reader.children(binary, WHERE)
        val unknown = children.keys.filter { it !in KNOWN }
        if (unknown.isNotEmpty()) {
            reader.refuse(
                WHERE,
                "has ${unknown.joinToString { "<$it>" }}, which it does not take; it takes ${KNOWN.joinToString { "<$it>" }}.",
                "Remove the unknown element(s).",
            )
        }

        val byClassifier = children[BY_CLASSIFIER]
            ?.let { reader.children(it, "$WHERE/$BY_CLASSIFIER") }
            .orEmpty()
            .mapValues { (classifier, hash) -> reader.text(hash, "$WHERE/$BY_CLASSIFIER/$classifier").orEmpty() }
        val settings = BinarySettings(
            version = children["version"]?.let { reader.text(it, "$WHERE/version") },
            sha256ByClassifier = byClassifier,
            path = children["path"]?.let { reader.text(it, "$WHERE/path") }?.let { appDirectory.resolve(it).toAbsolutePath().normalize().toString() },
            sha256 = children["sha256"]?.let { reader.text(it, "$WHERE/sha256") },
        )

        return if (reader.problems.isEmpty()) BinaryElementRead.Read(settings) else BinaryElementRead.Refused(reader.problems.toList())
    }

    private class Reader(private val evaluate: (String) -> String?) {
        val problems = mutableListOf<ConfigProblem>()

        fun refuse(path: String, reason: String, fix: String) {
            problems += ConfigurationConverter.shapeProblem(path, reason, fix)
        }

        // The child elements of [element] by name; text in their place, a repeated name or an attribute is refused.
        fun children(element: PlexusConfiguration, path: String): Map<String, PlexusConfiguration> {
            refuseAttributes(element, path)
            if (element.childCount == 0 && !element.value.isNullOrBlank()) {
                refuse(path, "is the text '${element.value.trim()}', but it takes child elements.", "Write each setting as a child element: <version>, or <path> with <sha256>.")
            }

            val children = linkedMapOf<String, PlexusConfiguration>()
            for (child in element.children) {
                if (child.name in children) {
                    refuse("$path/${child.name}", "is set twice.", "Set it once.")
                    continue
                }
                children[child.name] = child
            }

            return children
        }

        // The evaluated, trimmed text of a leaf element, null when empty.
        fun text(element: PlexusConfiguration, path: String): String? {
            refuseAttributes(element, path)
            if (element.childCount > 0) {
                refuse(path, "holds child elements, but it takes a text.", "Write the value as the element's text.")
                return null
            }

            val written = element.value ?: return null
            val evaluated = evaluate(written)
            if (evaluated == null) {
                refuse(path, ConfigurationConverter.unresolvedReason(written), ConfigurationConverter.UNRESOLVED_FIX)
                return null
            }

            return evaluated.trim().ifEmpty { null }
        }

        private fun refuseAttributes(element: PlexusConfiguration, path: String) {
            val attributes = element.attributeNames.filterNot { it.startsWith(ConfigurationConverter.MAVEN_MERGE_PREFIX) }
            if (attributes.isNotEmpty()) {
                refuse(path, "has the attribute(s) ${attributes.joinToString { "'$it'" }}, which it does not take.", "Write each value as a child element.")
            }
        }
    }
}
