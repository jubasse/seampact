package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.ir.binary.BinaryFailure
import io.github.jubasse.seampact.ir.bundle.BundleFailure
import io.github.jubasse.seampact.ir.config.ConfigProblem
import io.github.jubasse.seampact.ir.read.IrRefusal
import io.github.jubasse.seampact.ir.write.WriterRefusal
import io.github.jubasse.seampact.springboot.SpringBootRefusal
import org.gradle.api.GradleException

// Every refusal of a run as one shape, the config problem's (code, message, fix, where), so the build prints them
// alike and the codes stay those of the Node CLI and the seampact-ir readers.

internal fun BundleFailure.toProblem(source: String): ConfigProblem {
    val values = listOfNotNull(expected?.let { "expected $it" }, actual?.let { "actual $it" })
    val detail = if (values.isEmpty()) "" else " (${values.joinToString(", ")})"

    return ConfigProblem(code.code, message + detail, fix, "source '$source'" + (file?.let { " $it" } ?: ""))
}

internal fun BinaryFailure.toProblem(where: String): ConfigProblem {
    val values = listOfNotNull(expected?.let { "expected $it" }, actual?.let { "actual $it" })
    val detail = if (values.isEmpty()) "" else " (${values.joinToString(", ")})"

    return ConfigProblem(code.code, message + detail, fix, where)
}

internal fun WriterRefusal.toProblem(where: String): ConfigProblem = ConfigProblem(code, message, fix, where)

internal fun SpringBootRefusal.toProblem(entryId: String, api: String): ConfigProblem {
    val operationPart = operation?.let { " operation '$it'" } ?: ""

    return ConfigProblem(code, message, fix, "entry '$entryId' api '$api'$operationPart $member")
}

internal fun IrRefusal.toProblem(entryId: String, api: String): ConfigProblem = ConfigProblem(
    code.code,
    message,
    "Use a contract this release of the spring-boot target reads, or update the plugin.",
    "entry '$entryId' api '$api' $member",
)

/** The text the build prints for [problems]: one block per problem, its code and place, its message and fix. */
internal fun problemsText(problems: List<ConfigProblem>): String = problems.joinToString("\n") { problem ->
    val where = problem.where?.let { " ($it)" } ?: ""

    "${problem.code}$where: ${problem.message}\n    Fix: ${problem.fix}"
}

/** A run that refused: every problem, named, so one build shows them all. */
internal class SeampactRefusedException(problems: List<ConfigProblem>) :
    GradleException("seampact refused the app config:\n" + problemsText(problems))
