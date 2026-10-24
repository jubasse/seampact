package io.github.jubasse.seampact.ir.config

/**
 * Why an app config, or a target entry's view of the IR, is refused: the same [code] as the Node CLI gives for the
 * same case, a [message] and its [fix], and [where] it is (`<file>:<line>:<column> <key path>`, `entry '<id>'`...).
 */
public data class ConfigProblem(val code: String, val message: String, val fix: String, val where: String? = null)

/** A key path into a config value: member names and array indexes. */
public typealias KeyPath = List<Any>

/** A key path as the config problems print it: `targets[1].link.validators`, as the Node CLI prints it. */
public fun formatKeyPath(path: KeyPath): String =
    path.mapIndexed { index, segment ->
        when {
            segment is Int -> "[$segment]"
            index == 0 -> segment.toString()
            else -> ".$segment"
        }
    }.joinToString("")
