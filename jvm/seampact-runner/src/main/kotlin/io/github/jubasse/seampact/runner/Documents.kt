package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.binary.BinaryDocumentsResult
import io.github.jubasse.seampact.ir.binary.BinaryInstall
import io.github.jubasse.seampact.ir.binary.BinaryRunner
import io.github.jubasse.seampact.ir.binary.DocumentsCommand
import io.github.jubasse.seampact.ir.binary.HandedConfig
import io.github.jubasse.seampact.ir.bundle.BundleFailureCode
import io.github.jubasse.seampact.ir.bundle.CachedBundle
import io.github.jubasse.seampact.ir.config.AppConfig
import io.github.jubasse.seampact.ir.config.AppConfigReader
import io.github.jubasse.seampact.ir.config.ConfigProblem
import io.github.jubasse.seampact.ir.config.EntryView
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.writeText

private const val NO_DOCUMENTS = "none"
private const val RUN_DIRECTORY_PREFIX = "documents-"
private const val DSL_CONFIG_FILE_NAME = "config.json"
private const val WARNING_PREFIX = "warning: "

/**
 * Whether the app has seampact OpenAPI documents (ADR 0011 "Which OpenAPI documents exist"): unless `openapi` is
 * `none`, the documents it lists, or without the key those of the apis its target entries serve. The pinned binary
 * writes and checks them; a run that asks for none never installs it.
 */
internal fun documentsAsked(config: AppConfig): Boolean {
    if (config.openapi == JsonPrimitive(NO_DOCUMENTS)) return false

    return config.openapi != null || config.entries.isNotEmpty() || config.otherEntries.isNotEmpty()
}

/**
 * The sources the binary reads for the app's documents, by the rule of its own run: those holding the api of any
 * target entry, this runner's or another's, or of any document `openapi` lists (ADR 0011: a source no ref uses is
 * never resolved). None without documents.
 */
internal fun documentSources(config: AppConfig): List<String> {
    if (!documentsAsked(config)) return emptyList()

    val listedApis = (config.openapi as? JsonObject)?.keys.orEmpty()
    val refs = (config.entries + config.otherEntries).flatMap { it.apiRefs } + listedApis

    return EntryView.sourcesHoldingRefs(config, refs)
}

/** What the binary's documents run printed, or the problems that refused it. */
internal sealed interface DocumentsRun {
    data class Done(val lines: List<String>, val warnings: List<String>) : DocumentsRun

    data class Refused(val problems: List<ConfigProblem>) : DocumentsRun
}

/**
 * Asks the pinned binary to write or check the app's OpenAPI documents ([command]); a run with no documents does not
 * start it. The binary makes no network request: each bundle source the run checked is handed over as its verified
 * cache directory, which the binary checks again against the source's integrity.
 * An app config the build file writes is handed over as a JSON file in a run directory under the build's temporary
 * directory, read as the app directory's config, and the run directory is removed after the run.
 */
internal fun runDocuments(prepared: PreparedRun.Prepared, settings: RunSettings, command: DocumentsCommand): DocumentsRun {
    if (!documentsAsked(prepared.config)) return DocumentsRun.Done(emptyList(), emptyList())

    val cached = prepared.bundles.associateWith { prepared.cachedBundle(it.integrity) }
    val gone = cached.mapNotNull { (bundle, entry) -> (entry as? CachedBundle.Unavailable)?.let { cacheEntryGone(bundle, it.entry) } }
    if (gone.isNotEmpty()) return DocumentsRun.Refused(gone)
    val handedBundles = cached.entries.associate { (bundle, entry) -> bundle.source to (entry as CachedBundle.Verified).directory }

    val installed = when (val install = prepared.binary()) {
        is BinaryInstall.Installed -> install.binary
        is BinaryInstall.Refused -> return DocumentsRun.Refused(listOf(install.failure.toProblem(OPENAPI_WHERE)))
    }

    val dslTree = settings.dslTree
    if (dslTree == null) {
        val configFile = settings.appDirectory.resolve(AppConfigReader.FILE_NAME)

        return documentsOutcome(BinaryRunner.documents(installed, configFile, command, bundleDirectories = handedBundles), settings.buildTool)
    }

    Files.createDirectories(settings.temporaryDirectory)
    val runDirectory = Files.createTempDirectory(settings.temporaryDirectory, RUN_DIRECTORY_PREFIX)
    try {
        val dslConfig = runDirectory.resolve(DSL_CONFIG_FILE_NAME)
        dslConfig.writeText(dslTree)

        return documentsOutcome(BinaryRunner.documents(installed, dslConfig, command, HandedConfig(settings.appDirectory, settings.dslName), handedBundles), settings.buildTool)
    } finally {
        runDirectory.toFile().deleteRecursively()
    }
}

// The run checked the bundle a moment ago; its cache entry went missing or changed since.
private fun cacheEntryGone(bundle: CheckedBundle, entry: Path?): ConfigProblem = ConfigProblem(
    BundleFailureCode.CACHE_INVALID.code,
    "The cached bundle of the source '${bundle.source}' at ${entry ?: "(no entry for ${bundle.integrity})"} is gone or fails the pinned-bundle check since this run read it; it is not handed to the compiler.",
    "Remove the folder the message names, then run the build again to fetch the bundle afresh.",
    "source '${bundle.source}'",
)

private const val OPENAPI_WHERE = "openapi"

private fun documentsOutcome(result: BinaryDocumentsResult, buildTool: BuildTool): DocumentsRun = when (result) {
    is BinaryDocumentsResult.Done -> DocumentsRun.Done(
        lines = printedLines(result.stdout).map { "seampact: compiler: $it" },
        warnings = printedLines(result.stderr).map { "seampact warning: ${it.removePrefix(WARNING_PREFIX)}" },
    )
    is BinaryDocumentsResult.Failed -> DocumentsRun.Refused(
        listOf(
            ConfigProblem(
                "binary.documents-refused",
                "The compiler exited with ${result.exitCode} on the app's OpenAPI documents:\n${result.stderr}${result.stdout}".trimEnd(),
                "Fix what the compiler's diagnostics say, reading `seampact generate` there as `${buildTool.generateCommand}`: a document that differs is written again by it, then committed; a document edited by hand is not overwritten, so delete it first.",
                OPENAPI_WHERE,
            ),
        ),
    )
    is BinaryDocumentsResult.NotRun -> DocumentsRun.Refused(listOf(result.failure.toProblem(OPENAPI_WHERE)))
}

private fun printedLines(text: String): List<String> = text.lines().filter { it.isNotBlank() }
