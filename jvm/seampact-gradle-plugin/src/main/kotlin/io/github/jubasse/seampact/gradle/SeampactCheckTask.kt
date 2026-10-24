package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.ir.config.AppConfig
import io.github.jubasse.seampact.ir.config.ConfigProblem
import io.github.jubasse.seampact.ir.write.PlanOutcome
import io.github.jubasse.seampact.ir.write.PlannedWrite
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.TaskAction
import org.gradle.work.DisableCachingByDefault
import java.nio.file.Files
import java.nio.file.Path

/**
 * `seampactCheck`, run by `check`: plans every entry as `seampactGenerate` does, in memory, with each bundle source
 * through the pinned-bundle check (its integrity printed), then compares the files a run would write with those on
 * disk at the `checks.generated` level (ADR 0011 `checks`, ADR 0015): drift at `error` fails, at `warning` is
 * printed, `disabled` is not looked for. An `outDir` under the build directory is not committed, so its files are
 * not compared. Nothing is written.
 */
@DisableCachingByDefault(because = "It checks the files on disk and writes nothing.")
public abstract class SeampactCheckTask : SeampactTask() {
    /** The project's build directory: an `outDir` under it is never committed, so its drift is not compared. */
    @get:Internal
    public abstract val buildDirectory: Property<String>

    @TaskAction
    public fun check() {
        val prepared = when (val run = prepareRun(runSettings())) {
            is PreparedRun.Refused -> throw SeampactRefusedException(run.problems)
            is PreparedRun.Prepared -> run
        }

        for (bundle in prepared.bundles) {
            logger.lifecycle("seampact: source '${bundle.source}' passes the pinned-bundle check, integrity ${bundle.integrity}.")
        }

        val outDir = prepared.config.outDir.toAbsolutePath().normalize()
        if (outDir.startsWith(Path.of(buildDirectory.get()).toAbsolutePath().normalize())) {
            // A refused entry still fails the check: generate would refuse it too.
            val refusals = prepared.plans.filterIsInstance<EntryPlan.Refused>().flatMap { it.problems }
            if (refusals.isNotEmpty()) throw SeampactRefusedException(refusals)

            logger.lifecycle("seampact: checks.generated is not compared: outDir $outDir is under the build directory, so its files are not committed.")
            return
        }

        val errors = mutableListOf<ConfigProblem>()
        val warnings = mutableListOf<ConfigProblem>()
        collectDrift(prepared, errors, warnings)

        val ignored = ignoredWarnings(prepared.config)
        warnings.filter { it.code !in ignored }.forEach { logger.warn("seampact warning: ${problemsText(listOf(it))}") }
        if (errors.isNotEmpty()) throw SeampactRefusedException(errors)

        logger.lifecycle("seampact: the generated files match the files on disk.")
    }

    private fun collectDrift(prepared: PreparedRun.Prepared, errors: MutableList<ConfigProblem>, warnings: MutableList<ConfigProblem>) {
        val level = checkLevel(prepared.config)
        for (plan in prepared.plans) {
            when (val drift = entryDrift(plan)) {
                is EntryDrift.Unreadable -> errors += drift.problems
                is EntryDrift.Listed -> if (level != DISABLED && drift.items.isNotEmpty()) {
                    val problem = driftProblem(plan.entryId, drift)
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

    private fun driftProblem(entryId: String, drift: EntryDrift.Listed) = ConfigProblem(
        "check.generated.drift",
        "The generated files of entry '$entryId' differ from the files on disk: ${drift.items.joinToString("; ")}.",
        drift.fix ?: "Run `gradle seampactGenerate` and commit the result, or set `checks.generated` to `warning` or `disabled` in the app config.",
        "entry '$entryId'",
    )

    private fun checkLevel(config: AppConfig): String =
        ((config.checks?.get("generated")) as? JsonPrimitive)?.content ?: ERROR

    private fun ignoredWarnings(config: AppConfig): Set<String> =
        ((config.warnings?.get("ignore") as? JsonArray) ?: JsonArray(emptyList()))
            .mapNotNull { (it as? JsonPrimitive)?.content }
            .toSet()

    private companion object {
        const val ERROR = "error"
        const val DISABLED = "disabled"
        val HAND_EDIT_CODES = setOf("writer.file.edited", "writer.file.not-generated")
    }
}
