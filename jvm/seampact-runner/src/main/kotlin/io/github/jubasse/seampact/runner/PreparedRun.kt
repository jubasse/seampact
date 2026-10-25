package io.github.jubasse.seampact.runner

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

/**
 * What one run of a seampact goal or task reads besides the app config: the build's inputs and resolvers.
 * [dslTree] is the app config the build file writes, as JSON, named [dslName] in problems; null reads the file.
 * [springBootVersion] and [springSecurityWebVersion] are the versions the compile classpath resolves, null without one.
 */
public class RunSettings(
    public val buildTool: BuildTool,
    public val appDirectory: Path,
    public val dslTree: String?,
    public val dslName: String,
    public val allowLocalVariable: String?,
    public val springBootVersion: String?,
    public val springSecurityWebVersion: String?,
    public val binary: BinarySettings,
    public val bundleCacheDirectory: Path,
    public val binaryCacheDirectory: Path,
    public val mavenArtefacts: MavenArtefactResolver,
    public val resolveBinaryArtefact: (BinaryPin.Artifact) -> Path,
)

/** A run with every entry planned (or refused one by one), or the problems that stop it before any entry. */
public sealed interface PreparedRun {
    public data class Prepared(val config: AppConfig, val bundles: List<CheckedBundle>, val plans: List<EntryPlan>) : PreparedRun

    public data class Refused(val problems: List<ConfigProblem>) : PreparedRun
}

/**
 * Reads the app config, gets the IR of each source the JVM entries use, and plans each entry's files, writing
 * nothing: the steps generate and check share, as the Node CLI's `prepareRun`.
 */
public fun prepareRun(settings: RunSettings): PreparedRun {
    val config = when (val read = readAppConfig(settings.appDirectory, settings.dslTree, settings.dslName)) {
        is AppConfigRead.Read -> read.config
        is AppConfigRead.Refused -> return PreparedRun.Refused(read.problems)
    }

    val configProblems = waitingForms(config) + EntryView.unknownSourceProblems(config)
    if (configProblems.isNotEmpty()) return PreparedRun.Refused(configProblems)

    // The build's environment, with SEAMPACT_ALLOW_LOCAL as the build's input holds it (git reads the rest).
    val environment = System.getenv().filterKeys { it != LocalSourcePolicy.ALLOW_LOCAL_VARIABLE } +
        listOfNotNull(settings.allowLocalVariable?.let { LocalSourcePolicy.ALLOW_LOCAL_VARIABLE to it })
    val contractApis = ContractApis(
        fetcher = BundleFetcher(settings.bundleCacheDirectory, environment, settings.mavenArtefacts),
        localSources = LocalSourcePolicy.of(config.allowLocal, environment),
        localRefusalReason = LocalSourcePolicy.refusalReason(environment),
        installBinary = { installBinary(settings.binary, settings.resolveBinaryArtefact, settings.binaryCacheDirectory, settings.buildTool) },
    )

    return when (val read = contractApis.read(config, EntryView.usedSources(config))) {
        is ContractApisOutcome.Refused -> PreparedRun.Refused(read.problems)
        is ContractApisOutcome.Read -> PreparedRun.Prepared(
            config,
            read.bundles,
            planEntries(config, read.apis, settings, runnerVersion()),
        )
    }
}

private const val RUNNER_PROPERTIES = "seampact-runner.properties"

/** The version of the plugins' shared run, which the generated header names: both plugins write the same files. */
public fun runnerVersion(): String {
    val properties = Properties()
    BuildTool::class.java.getResourceAsStream(RUNNER_PROPERTIES)?.use(properties::load)
        ?: error("The seampact-runner jar holds no $RUNNER_PROPERTIES; it was not built by its own build.")

    return properties.getProperty("version")
}
