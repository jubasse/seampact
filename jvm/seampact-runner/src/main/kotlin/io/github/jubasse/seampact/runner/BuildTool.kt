package io.github.jubasse.seampact.runner

/**
 * The build tool a run serves, as the problems and messages name it: [pluginName] ("the Gradle plugin"), the
 * [generateCommand] a fix tells to run, and the fix of a compiler binary the build's repositories do not resolve.
 */
public data class BuildTool(
    val pluginName: String,
    val generateCommand: String,
    val unresolvedBinaryFix: String,
)
