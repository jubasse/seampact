package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.config.ConfigProblem
import io.github.jubasse.seampact.springboot.SpringBootTarget
import java.net.URLClassLoader
import java.nio.file.Path

// The generate-time check of the runtime (ADR 0025, G2): the seampact-spring-runtime on the classpath that compiles
// the generated code, read from its version constant, compared with the generator's full version. The runtime serves
// code of its own `major.minor` from a generator at its patch or an earlier one.

/** The rule id of a generate refused because the app's classpath has no runtime. */
public const val RUNTIME_MISSING: String = "runtime.missing"

/** The rule id of a generate refused because the runtime on the classpath is not one the generator writes for. */
public const val RUNTIME_VERSION_MISMATCH: String = "runtime.version-mismatch"

private const val VERSION_CLASS = "io.github.jubasse.seampact.springboot.runtime.SeampactRuntimeVersion"
private const val VERSION_FIELD = "VERSION"
private const val WHERE = "the compile classpath of the generated code"
private val RELEASE_VERSION = Regex("""(\d+)\.(\d+)\.(\d+)""")

/** The version constant of the runtime on [compileClasspath], or null when no entry holds the runtime. */
public fun installedSpringRuntimeVersion(compileClasspath: List<Path>): String? {
    val urls = compileClasspath.map { it.toUri().toURL() }.toTypedArray()

    // No parent: only the app's classpath answers, never the copy the plugin itself runs with.
    return URLClassLoader(urls, null).use { loader ->
        val versionClass = try {
            Class.forName(VERSION_CLASS, false, loader)
        } catch (absent: ClassNotFoundException) {
            return@use null
        }

        versionClass.getField(VERSION_FIELD).get(null) as? String
            ?: error("$VERSION_CLASS on the compile classpath holds no $VERSION_FIELD string; reinstall ${SpringBootTarget.RUNTIME_MODULE}.")
    }
}

/** The refusals of the runtime on [compileClasspath]; none when it serves the code [generatorVersion] writes. */
public fun springRuntimeProblems(
    compileClasspath: List<Path>,
    buildTool: BuildTool,
    generatorVersion: String = SpringBootTarget.VERSION,
): List<ConfigProblem> {
    val installed = installedSpringRuntimeVersion(compileClasspath) ?: return listOf(runtimeMissing(buildTool, generatorVersion))

    return when (runtimeVerdict(installed, generatorVersion)) {
        RuntimeVerdict.SERVES -> emptyList()
        RuntimeVerdict.OLDER_PATCH -> listOf(olderRuntimePatch(installed, buildTool, generatorVersion))
        RuntimeVerdict.OTHER_MINOR -> listOf(otherRuntimeMinor(installed, buildTool, generatorVersion))
    }
}

private enum class RuntimeVerdict { SERVES, OTHER_MINOR, OLDER_PATCH }

// The same version serves; otherwise both are release versions of one `major.minor` and the runtime's patch is at or
// above the generator's. A prerelease version serves only itself.
private fun runtimeVerdict(installedVersion: String, generatorVersion: String): RuntimeVerdict {
    if (installedVersion == generatorVersion) return RuntimeVerdict.SERVES

    val installed = RELEASE_VERSION.matchEntire(installedVersion)?.groupValues ?: return RuntimeVerdict.OTHER_MINOR
    val generator = RELEASE_VERSION.matchEntire(generatorVersion)?.groupValues ?: return RuntimeVerdict.OTHER_MINOR

    if (installed[1] != generator[1] || installed[2] != generator[2]) return RuntimeVerdict.OTHER_MINOR

    return if (installed[3].toLong() >= generator[3].toLong()) RuntimeVerdict.SERVES else RuntimeVerdict.OLDER_PATCH
}

private fun generatorName(version: String): String = "`${SpringBootTarget.USE} $version`"

private fun runtimeName(version: String): String = "`${SpringBootTarget.RUNTIME_MODULE} $version`"

private fun runtimeMissing(buildTool: BuildTool, generatorVersion: String): ConfigProblem = ConfigProblem(
    RUNTIME_MISSING,
    "${generatorName(generatorVersion)} generates code that imports `${SpringBootTarget.RUNTIME_MODULE}`, which this app does not install.",
    "Install it at the generator's version: ${buildTool.runtimeInstall(generatorVersion)}.",
    WHERE,
)

private fun otherRuntimeMinor(installed: String, buildTool: BuildTool, generatorVersion: String): ConfigProblem {
    val release = RELEASE_VERSION.matchEntire(generatorVersion)?.groupValues
    val writtenFor = if (release == null) generatorVersion else "${release[1]}.${release[2]}.x"

    return ConfigProblem(
        RUNTIME_VERSION_MISMATCH,
        "${runtimeName(installed)} is installed, ${generatorName(generatorVersion)} generates for `$writtenFor`.",
        "Install the runtime at the generator's version (${buildTool.runtimeInstall(generatorVersion)}), or move ${buildTool.pluginName} to the runtime's version, `$installed`.",
        WHERE,
    )
}

private fun olderRuntimePatch(installed: String, buildTool: BuildTool, generatorVersion: String): ConfigProblem = ConfigProblem(
    RUNTIME_VERSION_MISMATCH,
    "${runtimeName(installed)} is older than the generator, ${generatorName(generatorVersion)}.",
    "Install the runtime at `$generatorVersion` or a later patch: ${buildTool.runtimeInstall(generatorVersion)}.",
    WHERE,
)
