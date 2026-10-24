package io.github.jubasse.seampact.ir.config

import io.github.jubasse.seampact.ir.schema.SchemaViolation
import io.github.jubasse.seampact.ir.schema.SpecSchemas
import io.github.jubasse.seampact.ir.schema.schemaResources

// A config value checked against `app.schema.json` or `root.schema.json` of `@seampact/spec`, through the pinned
// JSON Schema validator, so the schema is never ported by hand. Each error becomes the problem `config.schema`
// in the Node CLI's forms: an unknown key, a missing key, a `oneOf` the value fits none of, or another keyword.

internal const val APP_SCHEMA = "app.schema.json"
internal const val ROOT_SCHEMA = "root.schema.json"

private val CONFIG_SCHEMAS by lazy {
    SpecSchemas(
        "https://seampact.dev/schemas/config",
        schemaResources("io/github/jubasse/seampact/ir/config", listOf(APP_SCHEMA, ROOT_SCHEMA)),
    )
}

private const val SCHEMA_FIX = "Correct the value as the config schema states (ADR 0011 'The app config')."
private const val ONE_OF = "oneOf"
private const val BOOT_CHECK_ARTEFACT = "bootCheck"

/** A problem the reader reports at a key before the schema check; the schema errors at or under it would repeat it. */
internal data class KeyProblem(val path: KeyPath, val problem: ConfigProblem)

/** The key problems first, then the schema problems they do not cover; empty when the value is valid. */
internal fun schemaProblems(tree: ConfigTree, kind: ConfigKind, schema: String, keyProblems: List<KeyProblem>): List<ConfigProblem> {
    val violations = CONFIG_SCHEMAS.validate(schema, tree.value)
    val reportedPaths = keyProblems.map { formatKeyPath(it.path) }.toSet()
    val oneOfPaths = violations.filter { it.keyword == ONE_OF }.map { formatKeyPath(it.instancePath) }.toSet()

    val schemaProblems = violations
        .filterNot { "/$ONE_OF/" in it.evaluationPath && formatKeyPath(it.instancePath) in oneOfPaths }
        .filterNot { it.keyword == ONE_OF && hasDeeperPath(it.instancePath, oneOfPaths) }
        .map { it.keyword to violationProblem(tree, kind, it) }
        .filterNot { (_, located) -> isAtOrUnder(located.keyPath, reportedPaths) }
        .filterNot { (keyword, located) -> keyword == ONE_OF && holdsReportedPath(located.keyPath, reportedPaths) }
        .map { (_, located) -> located.problem }
        .distinct()

    return keyProblems.map { it.problem } + schemaProblems
}

private data class LocatedProblem(val keyPath: String, val problem: ConfigProblem)

// An outer `oneOf` fails because an inner one did; the inner one names the value to correct.
private fun hasDeeperPath(instancePath: KeyPath, oneOfPaths: Set<String>): Boolean {
    val keyPath = formatKeyPath(instancePath)

    return oneOfPaths.any { it != keyPath && isBelow(it, keyPath) }
}

// A value fails its `oneOf` because of a key reported already, such as a waiting key: that report names it.
private fun holdsReportedPath(keyPath: String, reportedPaths: Set<String>): Boolean =
    reportedPaths.any { it != keyPath && isBelow(it, keyPath) }

private fun isAtOrUnder(keyPath: String, reportedPaths: Set<String>): Boolean =
    reportedPaths.any { keyPath == it || isBelow(keyPath, it) }

private fun isBelow(path: String, ancestor: String): Boolean =
    ancestor.isEmpty() || path.startsWith("$ancestor.") || path.startsWith("$ancestor[")

private fun violationProblem(tree: ConfigTree, kind: ConfigKind, violation: SchemaViolation): LocatedProblem {
    val path = violation.instancePath
    val property = violation.property

    if (violation.keyword == "additionalProperties" && property != null) {
        val withKey = path + property
        return LocatedProblem(
            formatKeyPath(withKey),
            ConfigProblem(
                "config.schema",
                "'$property' is not a key the ${kind.text} takes here.",
                "Remove the key, or correct its spelling (ADR 0011 'The app config').",
                tree.whereOf(withKey),
            ),
        )
    }

    if (violation.keyword == "required" && property != null) {
        return LocatedProblem(
            formatKeyPath(path),
            ConfigProblem("config.schema", "The key '$property' is required here.", "Add '$property'.", tree.whereOf(path)),
        )
    }

    if (violation.keyword == ONE_OF) {
        val (message, fix) = oneOfSentences(path)
        return LocatedProblem(formatKeyPath(path), ConfigProblem("config.schema", message, fix, tree.whereOf(path)))
    }

    return LocatedProblem(
        formatKeyPath(path),
        ConfigProblem("config.schema", "The value fails the schema keyword '${violation.keyword}': ${violation.message}.", SCHEMA_FIX, tree.whereOf(path)),
    )
}

// The forms a `oneOf` of the config schemas lets a value take, by where it sits.
private fun oneOfSentences(path: KeyPath): Pair<String, String> {
    val first = path.firstOrNull()

    return when {
        first == "sources" -> Pair(
            "A source takes one form: 'path', 'package' with 'version', 'release', 'git' or 'maven'; 'integrity' goes with a bundle form only.",
            "Keep the keys of one form (ADR 0011 'The app config').",
        )
        path.lastOrNull() == BOOT_CHECK_ARTEFACT -> Pair(
            "'bootCheck' is true, false or '{ frameworkRoutes }'.",
            "Switch the boot check with a boolean, or its framework-route check alone with '{ frameworkRoutes: false }'.",
        )
        first == "targets" -> Pair(
            "A target entry takes exactly one of 'api' and 'apis'.",
            "Name one api with 'api', or several with 'apis'.",
        )
        path.lastOrNull() == "extensions" -> Pair(
            "'extensions' is 'all', 'none' or a list of extension names.",
            "Write 'all', 'none' or a list such as [access, paging].",
        )
        path.size == 1 -> Pair(
            "'openapi' is 'none' or a mapping from api names to their documents.",
            "Write 'openapi: none', or map each api to its document's path.",
        )
        else -> Pair(
            "An api's documents are a path, '{ path, ...options }', or a mapping from each document id to one of those.",
            "Write the path of the api's one document, or map each of its documents to a path (ADR 0011 'The app config').",
        )
    }
}
