package io.github.jubasse.seampact.runner

/**
 * The build tool a run serves, as the problems and messages name it: [pluginName] ("the Gradle plugin"), the
 * [generateCommand] a fix tells to run, the fix of a compiler binary the build's repositories do not resolve, the
 * setting the binary cache directory comes from, which a relative cache refusal names, and how the app gets
 * seampact-spring-runtime at a version, [runtimeInstallTemplate] with [VERSION_PLACEHOLDER] for the version.
 */
public data class BuildTool(
    val pluginName: String,
    val generateCommand: String,
    val unresolvedBinaryFix: String,
    val binaryCacheSetting: String,
    val runtimeInstallTemplate: String,
) {
    /** How the app gets seampact-spring-runtime at [version], for a runtime refusal's fix. */
    public fun runtimeInstall(version: String): String = runtimeInstallTemplate.replace(VERSION_PLACEHOLDER, version)

    public companion object {
        /** The place of the version in [runtimeInstallTemplate]. */
        public const val VERSION_PLACEHOLDER: String = "{version}"
    }
}
