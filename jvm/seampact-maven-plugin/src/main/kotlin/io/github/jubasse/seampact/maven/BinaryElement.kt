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
 * combinations pin is the runner's rule, the same as the Gradle `binary { }` block's.
 */
internal object BinaryElement {
    private const val WHERE = "<configuration>/binary"
    private val KNOWN = setOf("version", "sha256ByClassifier", "path", "sha256")

    fun read(binary: PlexusConfiguration?, evaluate: (String) -> String, appDirectory: Path): BinaryElementRead {
        if (binary == null) return BinaryElementRead.Read(BinarySettings(null, emptyMap(), null, null))

        val children = binary.children.associateBy { it.name }
        val unknown = binary.children.map { it.name }.filter { it !in KNOWN }
        if (unknown.isNotEmpty()) {
            return BinaryElementRead.Refused(
                listOf(
                    ConfigProblem(
                        ConfigurationConverter.SHAPE_CODE,
                        "The <binary> element has ${unknown.joinToString { "<$it>" }}, which it does not take; it takes ${KNOWN.joinToString { "<$it>" }}.",
                        "Remove the unknown element(s).",
                        WHERE,
                    ),
                ),
            )
        }

        fun text(name: String): String? = children[name]?.value?.let(evaluate)?.trim()?.ifEmpty { null }
        val byClassifier = children["sha256ByClassifier"]?.children.orEmpty()
            .associate { it.name to (it.value?.let(evaluate)?.trim() ?: "") }

        return BinaryElementRead.Read(
            BinarySettings(
                version = text("version"),
                sha256ByClassifier = byClassifier,
                path = text("path")?.let { appDirectory.resolve(it).toAbsolutePath().normalize().toString() },
                sha256 = text("sha256"),
            ),
        )
    }
}
