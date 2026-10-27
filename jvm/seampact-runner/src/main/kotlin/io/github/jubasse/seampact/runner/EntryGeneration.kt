package io.github.jubasse.seampact.runner

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
import io.github.jubasse.seampact.springboot.FrameworkRoute
import io.github.jubasse.seampact.springboot.SpringBootEntry
import io.github.jubasse.seampact.springboot.SpringBootRefusedException
import io.github.jubasse.seampact.springboot.SpringBootTarget
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// The entry's `frameworkRoutes`, already checked against the app config schema.
private fun frameworkRoutesOf(entry: AppConfigEntry): List<FrameworkRoute> =
    (entry.entry["frameworkRoutes"] as? JsonArray).orEmpty().map { item ->
        val route = item.jsonObject
        FrameworkRoute(
            path = route.getValue("path").jsonPrimitive.content,
            reason = route.getValue("reason").jsonPrimitive.content,
            method = route["method"]?.jsonPrimitive?.content,
        )
    }

/**
 * Generates each JVM entry from its view of the IR (ADR 0011 "The app config") and plans its write into its output
 * root (ADR 0015 "Writing files"), with nothing written: `generate` commits the plans only when every entry planned,
 * so a refused entry leaves every root as it was, and `check` compares them.
 */
internal fun planEntries(config: AppConfig, apis: List<SourceApi>, settings: RunSettings, runnerVersion: String): List<EntryPlan> {
    val buildTool = settings.buildTool

    return config.entries.map { entry ->
        when (val generated = generateEntry(entry, apis, settings, runnerVersion)) {
            is EntryFiles.Refused -> EntryPlan.Refused(entry.id, generated.problems)
            is EntryFiles.Generated -> {
                val plan = GeneratedWriter.plan(entry.root, entry.id, generated.files, HandEditPolicy.REFUSE)
                EntryPlan.Planned(entry.id, withBuildToolFixes(plan, buildTool))
            }
        }
    }
}

private const val HAND_EDIT_CODE = "writer.file.edited"

// The writer's hand-edit fix, in the build tool's own terms: the plugins have no force option.
private fun withBuildToolFixes(outcome: PlanOutcome, buildTool: BuildTool): PlanOutcome = when (outcome) {
    is PlanOutcome.Planned -> outcome
    is PlanOutcome.Refused -> PlanOutcome.Refused(
        outcome.refusals.map { if (it.code == HAND_EDIT_CODE) it.copy(fix = handEditFix(buildTool)) else it },
    )
}

private fun handEditFix(buildTool: BuildTool): String =
    "Restore the file or delete it, then run `${buildTool.generateCommand}`; hand-written code goes next to the generated files, not in them."

/** One entry's plan: the writer's plan of its files, or the problems that keep it from generating. */
public sealed interface EntryPlan {
    public val entryId: String

    public data class Planned(override val entryId: String, val plan: PlanOutcome) : EntryPlan

    public data class Refused(override val entryId: String, val problems: List<ConfigProblem>) : EntryPlan
}

private sealed interface EntryFiles {
    data class Generated(val files: List<GeneratedFile>) : EntryFiles

    data class Refused(val problems: List<ConfigProblem>) : EntryFiles
}

private const val SPRING_SECURITY_OPTION = "springSecurity"

// Without the option, the Spring Security beans follow the compile classpath (ADR 0022 "Native security layers"):
// on when spring-security-web is there.
private fun optionsWithSpringSecurityDefault(options: JsonObject, springSecurityWebVersion: String?): JsonObject =
    if (SPRING_SECURITY_OPTION in options) options else JsonObject(options + (SPRING_SECURITY_OPTION to JsonPrimitive(springSecurityWebVersion != null)))

// The option turned on while the compile classpath has no spring-security-web: the beans would not compile.
private fun springSecurityWithoutModule(entry: AppConfigEntry, springSecurityWebVersion: String?): ConfigProblem? {
    val option = entry.options[SPRING_SECURITY_OPTION]
    val turnedOn = option == JsonPrimitive(true) || option is JsonObject
    if (!turnedOn || springSecurityWebVersion != null) return null

    return ConfigProblem(
        "options.springSecurity.unavailable",
        "The option 'springSecurity' is $option, but the compile classpath resolves no org.springframework.security:spring-security-web, so the Spring Security beans would not compile.",
        "Add spring-boot-starter-security to the app's dependencies, or set 'springSecurity' to false.",
        "entry '${entry.id}' options springSecurity",
    )
}

private const val MATCHERS_MEMBER = "matchers"

// `{ matchers: true }` adds a customizer typed against spring-security-config, which spring-security-web alone lacks.
private fun securityMatchersWithoutModule(entry: AppConfigEntry, springSecurityConfigVersion: String?): ConfigProblem? {
    val option = entry.options[SPRING_SECURITY_OPTION] as? JsonObject ?: return null
    if (option[MATCHERS_MEMBER] != JsonPrimitive(true) || springSecurityConfigVersion != null) return null

    return ConfigProblem(
        "options.springSecurity.matchers.unavailable",
        "The option 'springSecurity' is $option, but the compile classpath resolves no org.springframework.security:spring-security-config, so the matchers customizer would not compile.",
        "Add spring-boot-starter-security to the app's dependencies, or set 'springSecurity' to true.",
        "entry '${entry.id}' options springSecurity matchers",
    )
}

private fun generateEntry(entry: AppConfigEntry, apis: List<SourceApi>, settings: RunSettings, runnerVersion: String): EntryFiles {
    val buildTool = settings.buildTool
    val springBootVersion = settings.springBootVersion

    if (entry.use != SpringBootTarget.USE) {
        return EntryFiles.Refused(
            listOf(
                ConfigProblem(
                    "config.target.unknown",
                    "The target entry '${entry.id}' uses '${entry.use}', which ${buildTool.pluginName} does not generate; it generates '${SpringBootTarget.USE}'.",
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
                    "Add Spring Boot ${testedMajorsOf(SpringBootTarget.USE)} to the app's dependencies (the Spring Boot plugin's starters, or its BOM and spring-boot-starter-webmvc).",
                    "entry '${entry.id}'",
                ),
            ),
        )
    }

    springSecurityWithoutModule(entry, settings.springSecurityWebVersion)?.let { return EntryFiles.Refused(listOf(it)) }
    securityMatchersWithoutModule(entry, settings.springSecurityConfigVersion)?.let { return EntryFiles.Refused(listOf(it)) }

    val viewed = when (val view = EntryView.of(entry, apis)) {
        is EntryViewOutcome.Viewed -> view.apis
        is EntryViewOutcome.Refused -> return EntryFiles.Refused(view.problems)
    }

    val target = SpringBootEntry(
        id = entry.id,
        options = optionsWithSpringSecurityDefault(entry.options, settings.springSecurityWebVersion),
        artefacts = entry.artefacts,
        frameworkDocs = entry.frameworkDocs,
        link = entry.link,
        frameworkRoutes = frameworkRoutesOf(entry),
        mount = entry.mount ?: "",
    )
    val files = mutableListOf<GeneratedFile>()
    val problems = mutableListOf<ConfigProblem>()

    for (api in viewed) {
        try {
            val ir = IrReader.read(api.ir, SpringBootTarget.IR_SUPPORT)
            val generated = SpringBootTarget.generate(ir, target).map { GeneratedFile(it.path, it.contents) }
            when (val finished = withGeneratedHeader(generated, HeaderSource(entry.use, runnerVersion, api.api))) {
                is HeaderOutcome.Finished -> files += finished.files
                is HeaderOutcome.Refused -> problems += finished.refusals.map { it.toProblem("entry '${entry.id}' api '${api.api}'") }
            }
        } catch (refused: IrRefusedException) {
            problems += refused.refusals.map { it.toProblem("entry '${entry.id}' api '${api.api}'") }
        } catch (refused: SpringBootRefusedException) {
            problems += refused.refusals.map { it.toProblem(entry.id, api.api) }
        }
    }

    return if (problems.isEmpty()) EntryFiles.Generated(files) else EntryFiles.Refused(problems)
}
