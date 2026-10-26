package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.binary.BinaryDocumentsResult
import io.github.jubasse.seampact.ir.binary.BinaryInstall
import io.github.jubasse.seampact.ir.binary.BinaryRunner
import io.github.jubasse.seampact.ir.binary.DocumentsCommand
import io.github.jubasse.seampact.ir.config.AppConfig
import io.github.jubasse.seampact.ir.config.AppConfigReader
import io.github.jubasse.seampact.ir.config.ConfigProblem
import io.github.jubasse.seampact.ir.config.ConfigSource
import kotlinx.serialization.json.JsonPrimitive
import java.nio.file.Files
import kotlin.io.path.writeText

private const val NO_DOCUMENTS = "none"
private const val DSL_CONFIG_PREFIX = ".seampact-build-config-"
private const val DSL_CONFIG_SUFFIX = ".json"
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
 * The binary's documents run fetches no bundle source: the binary reads the app config itself and makes no network
 * request, so an app whose documents come from a bundle source waits, refused by name.
 */
internal fun documentsWaitingForms(config: AppConfig): List<ConfigProblem> {
    if (!documentsAsked(config)) return emptyList()

    val bundleSources = config.sources.filterValues { it is ConfigSource.Bundle }.keys.sorted()
    if (bundleSources.isEmpty()) return emptyList()

    return listOf(
        ConfigProblem(
            "config.key.waits",
            "seampact's OpenAPI documents of an app with a bundle source (${bundleSources.joinToString(", ") { "'$it'" }}) are not written by the JVM build plugins yet: the compiler binary writes them from `path` sources only.",
            "Set `openapi: none` for now, or compile the contract from a `path` source; the framework's own document (springdoc) is not touched.",
            "${config.displayName} openapi",
        ),
    )
}

/** What the binary's documents run printed, or the problems that refused it. */
internal sealed interface DocumentsRun {
    data class Done(val lines: List<String>, val warnings: List<String>) : DocumentsRun

    data class Refused(val problems: List<ConfigProblem>) : DocumentsRun
}

/**
 * Asks the pinned binary to write or check the app's OpenAPI documents ([command]); a run with no documents does not
 * start it. The binary reads the app config file; an app config the build file writes is handed over as a JSON file
 * in the app directory, so its relative paths stay those of the app, and the file is removed after the run.
 */
internal fun runDocuments(
    config: AppConfig,
    settings: RunSettings,
    command: DocumentsCommand,
    binary: () -> BinaryInstall,
): DocumentsRun {
    if (!documentsAsked(config)) return DocumentsRun.Done(emptyList(), emptyList())

    val installed = when (val install = binary()) {
        is BinaryInstall.Installed -> install.binary
        is BinaryInstall.Refused -> return DocumentsRun.Refused(listOf(install.failure.toProblem(OPENAPI_WHERE)))
    }

    val dslTree = settings.dslTree
    if (dslTree == null) {
        return documentsOutcome(BinaryRunner.documents(installed, settings.appDirectory.resolve(AppConfigReader.FILE_NAME), command), settings.buildTool)
    }

    val dslConfig = Files.createTempFile(settings.appDirectory, DSL_CONFIG_PREFIX, DSL_CONFIG_SUFFIX)
    try {
        dslConfig.writeText(dslTree)

        return documentsOutcome(BinaryRunner.documents(installed, dslConfig, command), settings.buildTool)
    } finally {
        Files.deleteIfExists(dslConfig)
    }
}

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
                "Fix what the compiler's diagnostics say; a document that differs is written again by `${buildTool.generateCommand}`, then committed.",
                OPENAPI_WHERE,
            ),
        ),
    )
    is BinaryDocumentsResult.NotRun -> DocumentsRun.Refused(listOf(result.failure.toProblem(OPENAPI_WHERE)))
}

private fun printedLines(text: String): List<String> = text.lines().filter { it.isNotBlank() }
