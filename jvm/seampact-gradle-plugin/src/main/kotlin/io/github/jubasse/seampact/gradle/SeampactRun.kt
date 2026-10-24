package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.ir.binary.BinaryPin
import io.github.jubasse.seampact.ir.bundle.BundleFetcher
import io.github.jubasse.seampact.ir.bundle.MavenArtefactResolver
import io.github.jubasse.seampact.ir.config.AppConfig
import io.github.jubasse.seampact.ir.config.AppConfigRead
import io.github.jubasse.seampact.ir.config.ConfigProblem
import io.github.jubasse.seampact.ir.config.EntryView
import io.github.jubasse.seampact.ir.config.LocalSourcePolicy
import java.nio.file.Path
import java.util.Properties

/** What one run of a seampact task reads besides the app config: the task's inputs and the build's resolvers. */
internal class RunSettings(
    val appDirectory: Path,
    val dslTree: String?,
    val allowLocalVariable: String?,
    val springBootVersion: String?,
    val binary: BinarySettings,
    val bundleCacheDirectory: Path,
    val binaryCacheDirectory: Path,
    val mavenArtefacts: MavenArtefactResolver,
    val resolveBinaryArtefact: (BinaryPin.Artifact) -> Path,
)

/** A run with every entry planned (or refused one by one), or the problems that stop it before any entry. */
internal sealed interface PreparedRun {
    data class Prepared(val config: AppConfig, val bundles: List<CheckedBundle>, val plans: List<EntryPlan>) : PreparedRun

    data class Refused(val problems: List<ConfigProblem>) : PreparedRun
}

/**
 * Reads the app config, gets the IR of each source the JVM entries use, and plans each entry's files, writing
 * nothing: the steps `seampactGenerate` and `seampactCheck` share, as the Node CLI's `prepareRun`.
 */
internal fun prepareRun(settings: RunSettings): PreparedRun {
    val config = when (val read = readAppConfig(settings.appDirectory, settings.dslTree)) {
        is AppConfigRead.Read -> read.config
        is AppConfigRead.Refused -> return PreparedRun.Refused(read.problems)
    }

    val configProblems = waitingForms(config) + EntryView.unknownSourceProblems(config)
    if (configProblems.isNotEmpty()) return PreparedRun.Refused(configProblems)

    // The build's environment, with SEAMPACT_ALLOW_LOCAL as the task input holds it (git reads the rest).
    val environment = System.getenv().filterKeys { it != LocalSourcePolicy.ALLOW_LOCAL_VARIABLE } +
        listOfNotNull(settings.allowLocalVariable?.let { LocalSourcePolicy.ALLOW_LOCAL_VARIABLE to it })
    val contractApis = ContractApis(
        fetcher = BundleFetcher(settings.bundleCacheDirectory, environment, settings.mavenArtefacts),
        localSources = LocalSourcePolicy.of(config.allowLocal, environment),
        localRefusalReason = LocalSourcePolicy.refusalReason(environment),
        installBinary = { installBinary(settings.binary, settings.resolveBinaryArtefact, settings.binaryCacheDirectory) },
    )

    return when (val read = contractApis.read(config, EntryView.usedSources(config))) {
        is ContractApisOutcome.Refused -> PreparedRun.Refused(read.problems)
        is ContractApisOutcome.Read -> PreparedRun.Prepared(
            config,
            read.bundles,
            planEntries(config, read.apis, settings.springBootVersion, pluginVersion()),
        )
    }
}

private const val PLUGIN_PROPERTIES = "seampact-plugin.properties"

/** The plugin's own version, which the generated header names. */
internal fun pluginVersion(): String {
    val properties = Properties()
    SeampactPlugin::class.java.getResourceAsStream(PLUGIN_PROPERTIES)?.use(properties::load)
        ?: error("The plugin jar holds no $PLUGIN_PROPERTIES; it was not built by its own build.")

    return properties.getProperty("version")
}
