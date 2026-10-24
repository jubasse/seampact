package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.ir.config.AppConfig
import io.github.jubasse.seampact.ir.config.AppConfigEntry
import io.github.jubasse.seampact.ir.config.ConfigProblem
import io.github.jubasse.seampact.ir.config.EntryView
import io.github.jubasse.seampact.ir.config.EntryViewOutcome
import io.github.jubasse.seampact.ir.config.SourceApi
import io.github.jubasse.seampact.ir.read.IrReader
import io.github.jubasse.seampact.ir.read.IrRefusedException
import io.github.jubasse.seampact.ir.write.GeneratedFile
import io.github.jubasse.seampact.ir.write.GeneratedWriter
import io.github.jubasse.seampact.ir.write.HandEditPolicy
import io.github.jubasse.seampact.ir.write.HeaderOutcome
import io.github.jubasse.seampact.ir.write.HeaderSource
import io.github.jubasse.seampact.ir.write.PlanOutcome
import io.github.jubasse.seampact.ir.write.withGeneratedHeader
import io.github.jubasse.seampact.springboot.SpringBootEntry
import io.github.jubasse.seampact.springboot.SpringBootRefusedException
import io.github.jubasse.seampact.springboot.SpringBootTarget
import kotlinx.serialization.json.JsonPrimitive

private const val WAITS_CODE = "config.key.waits"
private const val NO_DOCUMENTS = "none"

/**
 * The app config's forms this plugin release does not serve yet, each refused by name with what brings it: seampact's
 * OpenAPI documents (written by the pinned binary in a later release), the compatibility matrix (`checks.matrix`,
 * `allowUntested`) and the boot check's `frameworkRoutes`.
 */
internal fun waitingForms(config: AppConfig): List<ConfigProblem> {
    if (config.entries.isEmpty()) return emptyList()

    val problems = mutableListOf<ConfigProblem>()
    if (config.openapi != JsonPrimitive(NO_DOCUMENTS)) {
        problems += ConfigProblem(
            WAITS_CODE,
            "seampact's OpenAPI documents are not written by the JVM build plugins yet; they come with the documents of the pinned compiler binary. An app with a server target writes them unless `openapi` is `none`.",
            "Set `openapi: none` for now; the framework's own document (springdoc) is not touched.",
            "${config.displayName} openapi",
        )
    }
    if (config.checks?.containsKey("matrix") == true) {
        problems += waits("`checks.matrix`", "the compatibility check of a later plugin release", "${config.displayName} checks.matrix")
    }
    for (entry in config.entries) {
        if ("allowUntested" in entry.entry) {
            problems += waits("`allowUntested`", "the compatibility check of a later plugin release", "entry '${entry.id}' allowUntested")
        }
        if ("frameworkRoutes" in entry.entry) {
            problems += waits("`frameworkRoutes`", "the boot check of the spring-boot boundary runtime", "entry '${entry.id}' frameworkRoutes")
        }
    }

    return problems
}

private fun waits(what: String, bringer: String, where: String) =
    ConfigProblem(WAITS_CODE, "$what is not available yet; it comes with $bringer.", "Remove it from the config for now.", where)

/**
 * Generates each JVM entry from its view of the IR (ADR 0011 "The app config") and plans its write into its output
 * root (ADR 0015 "Writing files"), with nothing written: `generate` commits the plans only when every entry planned,
 * so a refused entry leaves every root as it was, and `check` compares them. [springBootVersion] is the version the
 * compile classpath resolves.
 */
internal fun planEntries(config: AppConfig, apis: List<SourceApi>, springBootVersion: String?, pluginVersion: String): List<EntryPlan> =
    config.entries.map { entry ->
        when (val generated = generateEntry(entry, apis, springBootVersion, pluginVersion)) {
            is EntryFiles.Refused -> EntryPlan.Refused(entry.id, generated.problems)
            is EntryFiles.Generated -> EntryPlan.Planned(entry.id, GeneratedWriter.plan(entry.root, entry.id, generated.files, HandEditPolicy.REFUSE))
        }
    }

/** One entry's plan: the writer's plan of its files, or the problems that keep it from generating. */
internal sealed interface EntryPlan {
    val entryId: String

    data class Planned(override val entryId: String, val plan: PlanOutcome) : EntryPlan

    data class Refused(override val entryId: String, val problems: List<ConfigProblem>) : EntryPlan
}

private sealed interface EntryFiles {
    data class Generated(val files: List<GeneratedFile>) : EntryFiles

    data class Refused(val problems: List<ConfigProblem>) : EntryFiles
}

private fun generateEntry(entry: AppConfigEntry, apis: List<SourceApi>, springBootVersion: String?, pluginVersion: String): EntryFiles {
    if (entry.use != SpringBootTarget.USE) {
        return EntryFiles.Refused(
            listOf(
                ConfigProblem(
                    "config.target.unknown",
                    "The target entry '${entry.id}' uses '${entry.use}', which the Gradle plugin does not generate; it generates '${SpringBootTarget.USE}'.",
                    "Use '${SpringBootTarget.USE}', or move the entry to the app of the runner that generates it.",
                    "entry '${entry.id}' use",
                ),
            ),
        )
    }

    if (springBootVersion == null) {
        return EntryFiles.Refused(
            listOf(
                ConfigProblem(
                    "framework.version.unresolved",
                    "The compile classpath resolves no org.springframework.boot:spring-boot, so the spring-boot target cannot check the Spring Boot version it generates for.",
                    "Add Spring Boot 4 to the app's dependencies (the Spring Boot plugin's starters, or its BOM and spring-boot-starter-webmvc).",
                    "entry '${entry.id}'",
                ),
            ),
        )
    }

    val viewed = when (val view = EntryView.of(entry, apis)) {
        is EntryViewOutcome.Viewed -> view.apis
        is EntryViewOutcome.Refused -> return EntryFiles.Refused(view.problems)
    }

    val target = SpringBootEntry(
        id = entry.id,
        options = entry.options,
        springBootVersion = springBootVersion,
        artefacts = entry.artefacts,
        frameworkDocs = entry.frameworkDocs,
        link = entry.link,
    )
    val files = mutableListOf<GeneratedFile>()
    val problems = mutableListOf<ConfigProblem>()

    for (api in viewed) {
        try {
            val ir = IrReader.read(api.ir, SpringBootTarget.IR_SUPPORT)
            val generated = SpringBootTarget.generate(ir, target).map { GeneratedFile(it.path, it.contents) }
            when (val finished = withGeneratedHeader(generated, HeaderSource(entry.use, pluginVersion, api.api))) {
                is HeaderOutcome.Finished -> files += finished.files
                is HeaderOutcome.Refused -> problems += finished.refusals.map { it.toProblem("entry '${entry.id}' api '${api.api}'") }
            }
        } catch (refused: IrRefusedException) {
            problems += refused.refusals.map { it.toProblem(entry.id, api.api) }
        } catch (refused: SpringBootRefusedException) {
            problems += refused.refusals.map { it.toProblem(entry.id, api.api) }
        }
    }

    return if (problems.isEmpty()) EntryFiles.Generated(files) else EntryFiles.Refused(problems)
}
