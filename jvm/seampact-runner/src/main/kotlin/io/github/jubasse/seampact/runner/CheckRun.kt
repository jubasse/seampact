package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.binary.DocumentsCommand
import io.github.jubasse.seampact.ir.config.AppConfig
import io.github.jubasse.seampact.ir.config.ConfigProblem
import io.github.jubasse.seampact.ir.write.PlanOutcome
import io.github.jubasse.seampact.ir.write.PlannedWrite
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import java.nio.file.Files
import java.nio.file.Path

/**
 * What a check run found: the [lines] the build prints, the [warnings] it prints as warnings, and the [problems]
 * that fail it; an empty [problems] passes.
 */
public data class CheckReport(val lines: List<String>, val warnings: List<String>, val problems: List<ConfigProblem>)

/**
 * The check both plugins run in their `check`: plans every entry as generate does, in memory, with each bundle source
 * through the pinned-bundle check (its integrity printed), then compares the files a run would write with those on
 * disk at the `checks.generated` level (ADR 0011 `checks`, ADR 0015): drift at `error` fails, at `warning` is
 * printed, `disabled` is not looked for. An `outDir` under [buildDirectory] is not committed, so its files are not
 * compared. The pinned binary checks the app's OpenAPI documents at `checks.openapi`. Nothing is written.
 */
public fun check(settings: RunSettings, buildDirectory: Path): CheckReport {
    val prepared = when (val run = prepareRun(settings)) {
        is PreparedRun.Refused -> return CheckReport(emptyList(), emptyList(), run.problems)
        is PreparedRun.Prepared -> run
    }

    val bundleLines = prepared.bundles.map { "seampact: source '${it.source}' passes the pinned-bundle check, integrity ${it.integrity}." }
    val documents = runDocuments(prepared, settings, DocumentsCommand.CHECK)
    val documentLines = (documents as? DocumentsRun.Done)?.lines.orEmpty()
    val documentWarnings = (documents as? DocumentsRun.Done)?.warnings.orEmpty()
    val documentProblems = (documents as? DocumentsRun.Refused)?.problems.orEmpty()
    val lines = bundleLines + documentLines

    val outDir = prepared.config.outDir.toAbsolutePath().normalize()
    if (outDir.startsWith(buildDirectory.toAbsolutePath().normalize())) {
        // A refused entry still fails the check: generate would refuse it too.
        val refusals = prepared.plans.filterIsInstance<EntryPlan.Refused>().flatMap { it.problems } + documentProblems
        val skipped = "seampact: checks.generated is not compared: outDir $outDir is under the build directory, so its files are not committed."

        return CheckReport(if (refusals.isEmpty()) lines + skipped else lines, printedWarnings(prepared) + documentWarnings, refusals)
    }

    val errors = documentProblems.toMutableList()
    val warnings = mutableListOf<ConfigProblem>()
    collectDrift(prepared, settings.buildTool, errors, warnings)

    val printed = printedWarnings(prepared, warnings) + documentWarnings
    val matched = if (errors.isEmpty()) listOf("seampact: the generated files match the files on disk.") else emptyList()

    return CheckReport(lines + matched, printed, errors)
}

private const val ERROR = "error"
private const val DISABLED = "disabled"
private val HAND_EDIT_CODES = setOf("writer.file.edited", "writer.file.not-generated")

private fun collectDrift(prepared: PreparedRun.Prepared, buildTool: BuildTool, errors: MutableList<ConfigProblem>, warnings: MutableList<ConfigProblem>) {
    val level = checkLevel(prepared.config)
    for (plan in prepared.plans) {
        when (val drift = entryDrift(plan)) {
            is EntryDrift.Unreadable -> errors += drift.problems
            is EntryDrift.Listed -> if (level != DISABLED && drift.items.isNotEmpty()) {
                val problem = driftProblem(plan.entryId, drift, buildTool)
                if (level == ERROR) errors += problem else warnings += problem
            }
        }
    }
}

private sealed interface EntryDrift {
    data class Listed(val items: List<String>, val fix: String?) : EntryDrift

    data class Unreadable(val problems: List<ConfigProblem>) : EntryDrift
}

// A hand-edited or foreign file is drift, named by the writer; any other refusal means the check cannot compare.
private fun entryDrift(plan: EntryPlan): EntryDrift = when (plan) {
    is EntryPlan.Refused -> EntryDrift.Unreadable(plan.problems)
    is EntryPlan.Planned -> when (val outcome = plan.plan) {
        is PlanOutcome.Planned -> EntryDrift.Listed(plannedDrift(outcome.write), null)
        is PlanOutcome.Refused -> {
            val other = outcome.refusals.filter { it.code !in HAND_EDIT_CODES }
            if (other.isNotEmpty()) {
                EntryDrift.Unreadable(other.map { it.toProblem("entry '${plan.entryId}'") })
            } else {
                EntryDrift.Listed(outcome.refusals.map { it.message.trimEnd('.') }, outcome.refusals.first().fix)
            }
        }
    }
}

private fun plannedDrift(write: PlannedWrite): List<String> =
    write.changed.map { path -> if (Files.exists(write.rootDir.resolve(path))) "$path (differs)" else "$path (missing)" } +
        write.removable.map { "$it (stale: generated earlier, no longer produced)" }

private fun driftProblem(entryId: String, drift: EntryDrift.Listed, buildTool: BuildTool) = ConfigProblem(
    "check.generated.drift",
    "The generated files of entry '$entryId' differ from the files on disk: ${drift.items.joinToString("; ")}.",
    drift.fix ?: "Run `${buildTool.generateCommand}` and commit the result, or set `checks.generated` to `warning` or `disabled` in the app config.",
    "entry '$entryId'",
)

private fun checkLevel(config: AppConfig): String =
    ((config.checks?.get("generated")) as? JsonPrimitive)?.content ?: ERROR

/**
 * The compatibility check's warnings, always printed (`warnings.ignore` scopes to a target's generate warnings, and
 * `allowUntested` silences a framework major), then [ignorable], less the codes `warnings.ignore` lists.
 */
internal fun printedWarnings(prepared: PreparedRun.Prepared, ignorable: List<ConfigProblem> = emptyList()): List<String> {
    val ignored = ignoredWarnings(prepared.config)

    return (prepared.warnings + ignorable.filter { it.code !in ignored }).map { "seampact warning: ${problemsText(listOf(it))}" }
}

private fun ignoredWarnings(config: AppConfig): Set<String> =
    ((config.warnings?.get("ignore") as? JsonArray) ?: JsonArray(emptyList()))
        .mapNotNull { (it as? JsonPrimitive)?.content }
        .toSet()
