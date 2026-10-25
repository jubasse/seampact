package io.github.jubasse.seampact.runner

/**
 * The build tool a run serves, as the problems and messages name it: [pluginName] ("the Gradle plugin"), the
 * [generateCommand] a fix tells to run, the fix of a compiler binary the build's repositories do not resolve, and the
 * setting the binary cache directory comes from, which a relative cache refusal names.
 */
public data class BuildTool(
    val pluginName: String,
    val generateCommand: String,
    val unresolvedBinaryFix: String,
    val binaryCacheSetting: String,
)
