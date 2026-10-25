package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.config.AppConfig
import io.github.jubasse.seampact.ir.config.AppConfigEntry
import io.github.jubasse.seampact.ir.config.ConfigProblem
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// The compatibility check of the JVM entries (ADR 0011 "The app config", ADR 0009), as the Node CLI runs it for the
// npm targets and with its codes: the framework version the compile classpath resolves is checked against the
// `jvmTargets` of `@seampact/spec`'s `compatibility/matrix.json`, which the build packs into this jar.

private const val MATRIX_RESOURCE = "matrix.json"
private const val MATRIX_LEVEL_KEY = "matrix"
private const val ERROR_LEVEL = "error"
private const val ALLOW_UNTESTED_KEY = "allowUntested"

/** A JVM target's framework as the matrix records it: the majors it is tested on and those it does not work on. */
internal data class JvmFramework(val id: String, val coordinates: String, val testedMajors: List<Int>, val incompatible: Map<Int, String>)

/** What the check found: [problems] refuse the run, [warnings] are printed. */
internal data class MatrixOutcome(val problems: List<ConfigProblem>, val warnings: List<ConfigProblem>)

/** The framework of each JVM target of the matrix, by its `use` coordinates. */
internal fun jvmFrameworks(): Map<String, JvmFramework> {
    val text = BuildTool::class.java.getResourceAsStream(MATRIX_RESOURCE)?.use { it.readBytes().decodeToString() }
        ?: error("The seampact-runner jar holds no $MATRIX_RESOURCE; it was not built by its own build.")

    return try {
        parseJvmFrameworks(text)
    } catch (failure: NoSuchElementException) {
        throw IllegalStateException("$MATRIX_RESOURCE is malformed: ${failure.message}", failure)
    } catch (failure: IllegalArgumentException) {
        throw IllegalStateException("$MATRIX_RESOURCE is malformed: ${failure.message}", failure)
    }
}

private fun parseJvmFrameworks(text: String): Map<String, JvmFramework> =
    Json.parseToJsonElement(text).jsonObject.member("jvmTargets", "the file").jsonArray.associate { item ->
        val target = item.jsonObject
        val where = "jvmTargets[${target["package"]?.jsonPrimitive?.content ?: "?"}]"
        val framework = target.member("framework", where).jsonObject

        target.member("package", where).jsonPrimitive.content to JvmFramework(
            id = framework.member("id", "$where.framework").jsonPrimitive.content,
            coordinates = framework.member("package", "$where.framework").jsonPrimitive.content,
            testedMajors = framework.member("tested", "$where.framework").jsonArray.map { it.jsonObject.major("$where.framework.tested") },
            incompatible = framework.member("incompatible", "$where.framework").jsonArray.associate {
                it.jsonObject.major("$where.framework.incompatible") to it.jsonObject.member("reason", "$where.framework.incompatible").jsonPrimitive.content
            },
        )
    }

private fun JsonObject.member(name: String, where: String): JsonElement =
    this[name] ?: throw NoSuchElementException("$where has no '$name'")

private fun JsonObject.major(where: String): Int =
    member("major", where).jsonPrimitive.intOrNull ?: throw IllegalArgumentException("$where holds a 'major' that is not an integer")

/**
 * Checks each JVM entry's framework against the matrix. Without a resolved version, or for a target the matrix does
 * not record, the entry's own generation refuses it by name (`framework.version.unresolved`, `config.target.unknown`).
 */
internal fun checkMatrix(config: AppConfig, frameworkVersion: String?, frameworks: Map<String, JvmFramework>): MatrixOutcome {
    val problems = mutableListOf<ConfigProblem>()
    val warnings = mutableListOf<ConfigProblem>()
    val untestedIsError = (config.checks?.get(MATRIX_LEVEL_KEY) as? JsonPrimitive)?.content == ERROR_LEVEL

    for (entry in config.entries) {
        val framework = frameworks[entry.use] ?: continue
        val allowed = allowUntestedOf(entry)

        problems += allowed.filter { frameworkIdOf(it) != framework.id }.map { foreignFramework(entry, it, framework) }
        warnings += allowed.filter { it in framework.testedMajors.map { major -> "${framework.id}@$major" } }.map { allowedTested(entry, it) }

        if (frameworkVersion == null) continue
        val major = frameworkVersion.takeWhile(Char::isDigit).toIntOrNull()
        if (major == null) {
            problems += unreadableVersion(entry, frameworkVersion, framework)
            continue
        }

        val incompatibleReason = framework.incompatible[major]
        if (incompatibleReason != null) {
            problems += incompatible(entry, frameworkVersion, major, incompatibleReason, framework)
            continue
        }

        if (major in framework.testedMajors || "${framework.id}@$major" in allowed) continue
        val untested = untested(entry, frameworkVersion, "${framework.id}@$major", framework)
        if (untestedIsError) problems += untested else warnings += untested
    }

    return MatrixOutcome(problems, warnings)
}

private fun allowUntestedOf(entry: AppConfigEntry): List<String> =
    (entry.entry[ALLOW_UNTESTED_KEY] as? JsonArray).orEmpty().map { it.jsonPrimitive.content }

// `<framework>@<major>`, as the app config schema checked it.
private fun frameworkIdOf(item: String): String = item.substringBeforeLast('@')

private fun where(entry: AppConfigEntry): String = "entry '${entry.id}'"

private fun testedText(framework: JvmFramework): String = framework.testedMajors.joinToString(", ")

/** The tested majors of the target [use], as the matrix records them, for the messages that name the framework to add. */
internal fun testedMajorsOf(use: String): String = testedText(jvmFrameworks().getValue(use))

private fun foreignFramework(entry: AppConfigEntry, item: String, framework: JvmFramework) = ConfigProblem(
    "config.matrix.unknown-framework",
    "The `allowUntested` item '$item' names the framework '${frameworkIdOf(item)}', and the target '${entry.use}' serves '${framework.id}'.",
    "Write the item as '${framework.id}@<major>', or remove it.",
    "${where(entry)} allowUntested",
)

private fun allowedTested(entry: AppConfigEntry, item: String) = ConfigProblem(
    "config.matrix.allowed-tested",
    "The `allowUntested` item '$item' names a major the compatibility matrix tests the target '${entry.use}' on, so it accepts nothing.",
    "Remove '$item' from the entry's `allowUntested`.",
    "${where(entry)} allowUntested",
)

private fun unreadableVersion(entry: AppConfigEntry, version: String, framework: JvmFramework) = ConfigProblem(
    "framework.version.unresolved",
    "The compile classpath resolves ${framework.coordinates} '$version', a version whose major the compatibility check cannot read.",
    "Depend on a released ${framework.coordinates} version, major ${testedText(framework)}.",
    where(entry),
)

private fun incompatible(entry: AppConfigEntry, version: String, major: Int, reason: String, framework: JvmFramework) = ConfigProblem(
    "config.matrix.incompatible",
    "${framework.coordinates} $version is on the compile classpath, and the target '${entry.use}' does not work on ${framework.id} $major: $reason",
    "Use a major of ${framework.coordinates} the target is tested on: ${testedText(framework)}.",
    where(entry),
)

private fun untested(entry: AppConfigEntry, version: String, allowItem: String, framework: JvmFramework) = ConfigProblem(
    "config.matrix.untested",
    "${framework.coordinates} $version is on the compile classpath, and the target '${entry.use}' is tested on ${framework.id} ${testedText(framework)} only.",
    "Use a tested major, or accept this one with `allowUntested: [$allowItem]` on the entry.",
    where(entry),
)
