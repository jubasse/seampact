package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.binary.DocumentsCommand
import io.github.jubasse.seampact.ir.config.ConfigProblem
import io.github.jubasse.seampact.ir.write.GeneratedWriter
import io.github.jubasse.seampact.ir.write.PlanOutcome
import io.github.jubasse.seampact.ir.write.PlannedWrite

/**
 * What a generate run did: the lines and the warnings the build prints, or every problem that refused it, with
 * nothing written.
 */
public sealed interface GenerateOutcome {
    public data class Generated(val lines: List<String>, val warnings: List<String>) : GenerateOutcome

    public data class Refused(val problems: List<ConfigProblem>) : GenerateOutcome
}

/**
 * Generates each JVM target entry of the app config into its output root (ADR 0015 "Writing files"). Every entry is
 * planned first; one refusal writes nothing. The pinned binary then writes the app's OpenAPI documents, before any
 * entry is written, so a refused document leaves the entries as they were too.
 */
public fun generate(settings: RunSettings): GenerateOutcome {
    val prepared = when (val run = prepareRun(settings)) {
        is PreparedRun.Refused -> return GenerateOutcome.Refused(run.problems)
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
    if (problems.isNotEmpty()) return GenerateOutcome.Refused(problems)

    val documents = when (val run = runDocuments(prepared, settings, DocumentsCommand.GENERATE)) {
        is DocumentsRun.Refused -> return GenerateOutcome.Refused(run.problems)
        is DocumentsRun.Done -> run
    }

    val lines = writes.map { write ->
        val written = GeneratedWriter.commit(write)
        "seampact: entry '${write.owner}' wrote ${written.written.size} file(s), kept ${written.unchanged.size}, removed ${written.removed.size} in ${write.rootDir}."
    }
    val left = prepared.config.otherEntries.map { other ->
        "seampact: entry '${other.id}' uses '${other.use}', which its own runner generates; ${settings.buildTool.pluginName} leaves it."
    }

    return GenerateOutcome.Generated(documents.lines + lines + left, printedWarnings(prepared) + documents.warnings)
}
