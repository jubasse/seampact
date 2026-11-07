package io.github.jubasse.seampact.ir.config

import kotlinx.serialization.json.JsonElement

/**
 * A config value as JSON, from a YAML file or a build plugin's DSL (A42: the same tree),
 * with the line and column of each key of a file, so each problem points at its key. [displayName] names the file,
 * or the DSL block, in problems.
 */
internal class ConfigTree(
    val value: JsonElement,
    val displayName: String,
    private val positions: Map<String, ConfigPosition>,
) {
    /** `<file>:<line>:<column> <key path>`, the position of the key when the path ends at one. */
    fun whereOf(path: KeyPath): String {
        val position = positionOf(path)?.let { ":${it.line}:${it.column}" } ?: ""
        val keyPath = if (path.isEmpty()) "" else " ${formatKeyPath(path)}"

        return "$displayName$position$keyPath"
    }

    private fun positionOf(path: KeyPath): ConfigPosition? = positions[formatKeyPath(path)]
}

/** A one-based line and column, as the Node CLI prints them. */
internal data class ConfigPosition(val line: Int, val column: Int)
