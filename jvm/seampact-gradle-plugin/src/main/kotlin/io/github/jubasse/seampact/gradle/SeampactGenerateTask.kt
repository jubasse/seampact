package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.ir.write.GeneratedWriter
import io.github.jubasse.seampact.ir.write.PlanOutcome
import io.github.jubasse.seampact.ir.write.PlannedWrite
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.OutputDirectories
import org.gradle.api.tasks.TaskAction

/**
 * `seampactGenerate`: generates each JVM target entry of the app config into its output root (ADR 0015 "Writing
 * files"), the roots the main Java sources compile. Every entry is planned first; one refusal writes nothing.
 */
@CacheableTask
public abstract class SeampactGenerateTask : SeampactTask() {
    /** Each JVM entry's output root, `<outDir>/<out>`. */
    @get:OutputDirectories
    public abstract val entryRoots: ConfigurableFileCollection

    @TaskAction
    public fun generate() {
        val prepared = when (val run = prepareRun(runSettings())) {
            is PreparedRun.Refused -> throw SeampactRefusedException(run.problems)
            is PreparedRun.Prepared -> run
        }

        val writes = mutableListOf<PlannedWrite>()
        val problems = prepared.plans.flatMap { plan ->
            when (plan) {
                is EntryPlan.Refused -> plan.problems
                is EntryPlan.Planned -> when (val outcome = plan.plan) {
                    is PlanOutcome.Planned -> {
                        writes += outcome.write
                        emptyList()
                    }
                    is PlanOutcome.Refused -> outcome.refusals.map { it.toProblem("entry '${plan.entryId}'") }
                }
            }
        }
        if (problems.isNotEmpty()) throw SeampactRefusedException(problems)

        for (write in writes) {
            val written = GeneratedWriter.commit(write)
            logger.lifecycle(
                "seampact: entry '${write.owner}' wrote ${written.written.size} file(s), kept ${written.unchanged.size}, removed ${written.removed.size} in ${write.rootDir}.",
            )
        }
        for (other in prepared.config.otherEntries) {
            logger.lifecycle("seampact: entry '${other.id}' uses '${other.use}', which its own runner generates; the Gradle plugin leaves it.")
        }
    }
}
