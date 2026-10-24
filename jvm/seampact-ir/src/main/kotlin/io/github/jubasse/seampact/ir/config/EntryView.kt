package io.github.jubasse.seampact.ir.config

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** One api a source holds, as its IR JSON document: what a bundle check or the binary's compile gives. */
public data class SourceApi(val source: String, val api: String, val ir: JsonObject)

/** The outcome of an entry's view: each api it names with only the operations it keeps, or the problems. */
public sealed interface EntryViewOutcome {
    public data class Viewed(val apis: List<SourceApi>) : EntryViewOutcome

    public data class Refused(val problems: List<ConfigProblem>) : EntryViewOutcome
}

/**
 * Each target entry's view of the IR (ADR 0011 "The app config"), as the Node CLI builds it before a target's
 * generate reads it (`api-refs.ts`, `filter-operations.ts`), with the same codes: the apis `api` or `apis` names,
 * an api named alone being the only one of its name among the sources, then for each api its `document` (its
 * surfaces, and `internal: exclude` drops internal operations), then `operations.include` (empty keeps all) and
 * `operations.exclude`, each item an operation id or a tag. Only `operations` shrinks; the rest of the IR is kept
 * as it is. The target reads the viewed document with its own support (`IrReader.read`).
 */
public object EntryView {
    private const val SOURCE_SEPARATOR = '/'

    /** Each `<source>/<api>` of the JVM entries whose source the app config does not define. */
    public fun unknownSourceProblems(config: AppConfig): List<ConfigProblem> =
        config.entries.flatMap { entry ->
            entry.apiRefs.map(::parseApiRef)
                .filter { it.source != null && it.source !in config.sources }
                .map { ref ->
                    ConfigProblem(
                        "config.api.unknown-source",
                        "The app config has no source '${ref.source}' (${config.sources.keys.joinToString(", ").ifEmpty { "none" }}).",
                        "Name one of the app config's `sources` before the '/', or add the source.",
                        entryWhere(entry.id, ref.api),
                    )
                }
        }

    /**
     * The sources the JVM entries use (ADR 0011: a source no entry uses is never resolved): each source a
     * `<source>/<api>` names and, when an api is named alone, every source, since only a source's IR tells its apis.
     */
    public fun usedSources(config: AppConfig): List<String> {
        val refs = config.entries.flatMap { it.apiRefs }.map(::parseApiRef)
        val named = refs.mapNotNull { it.source }.toSet()
        val anyAlone = refs.any { it.source == null }

        return config.sources.keys.filter { anyAlone || it in named }
    }

    /** The view of [entry] over the apis of its sources. */
    public fun of(entry: AppConfigEntry, apis: List<SourceApi>): EntryViewOutcome {
        val resolved = mutableListOf<SourceApi>()
        val problems = mutableListOf<ConfigProblem>()

        for (text in entry.apiRefs) {
            val ref = parseApiRef(text)
            val candidates = apis.filter { it.api == ref.api && (ref.source == null || it.source == ref.source) }
            val found = candidates.firstOrNull()

            when {
                candidates.size > 1 -> problems += ConfigProblem(
                    "config.api.ambiguous",
                    "The api '${ref.api}' exists in the sources ${candidates.joinToString(", ") { "'${it.source}'" }}.",
                    "Name it as `<source>/${ref.api}`.",
                    entryWhere(entry.id, ref.api),
                )
                found == null -> problems += ConfigProblem(
                    "config.api.unknown",
                    "No source of the app config holds an api '$text'.",
                    "Name an api of a source's `workspace.yaml`, as `<api>` or `<source>/<api>`.",
                    entryWhere(entry.id, ref.api),
                )
                resolved.any { it.api == found.api } -> problems += duplicateApiProblem(entry, text, found.api)
                else -> resolved += found
            }
        }
        if (problems.isNotEmpty()) return EntryViewOutcome.Refused(problems)

        val viewed = mutableListOf<SourceApi>()
        for (api in resolved) {
            when (val outcome = filterOperations(api.ir, entry)) {
                is FilterOutcome.Filtered -> viewed += api.copy(ir = outcome.ir)
                is FilterOutcome.Refused -> problems += outcome.problems.map { it.copy(where = entryWhere(entry.id, api.api)) }
            }
        }

        return if (problems.isEmpty()) EntryViewOutcome.Viewed(viewed) else EntryViewOutcome.Refused(problems)
    }

    private data class ApiRef(val source: String?, val api: String)

    private fun parseApiRef(text: String): ApiRef {
        val separator = text.indexOf(SOURCE_SEPARATOR)
        if (separator == -1) return ApiRef(null, text)

        return ApiRef(text.substring(0, separator), text.substring(separator + 1))
    }

    // ADR 0011 places each api under `<out>/<api>`, so two items of one entry cannot share an api name.
    private fun duplicateApiProblem(entry: AppConfigEntry, text: String, api: String): ConfigProblem {
        val items = entry.apiRefs.filter { parseApiRef(it).api == api }

        return ConfigProblem(
            "config.api.duplicate",
            "The entry '${entry.id}' names the api '$api' more than once (${items.joinToString(", ") { "'$it'" }}); '$text' is one of them.",
            "Keep one of them, or give the sources' apis different names.",
            entryWhere(entry.id, api),
        )
    }
}

private fun entryWhere(entryId: String, api: String): String = "entry '$entryId', api '$api'"

private sealed interface FilterOutcome {
    data class Filtered(val ir: JsonObject) : FilterOutcome

    data class Refused(val problems: List<ConfigProblem>) : FilterOutcome
}

private fun filterOperations(ir: JsonObject, entry: AppConfigEntry): FilterOutcome {
    val operations = (ir["operations"] as? JsonArray)?.filterIsInstance<JsonObject>() ?: emptyList()
    val api = ir["api"] as? JsonObject ?: JsonObject(emptyMap())
    val apiId = api.stringAt("id") ?: ""
    val documents = api["documents"] as? JsonObject ?: JsonObject(emptyMap())
    val document = entry.document

    val unknown = unknownSelectionProblems(apiId, documents, operations, entry)
    if (unknown.isNotEmpty()) return FilterOutcome.Refused(unknown)

    val inDocument = operations.filter { isInDocument(documents, document, it) }
    val removedItems = entry.include.filter { item -> inDocument.none { matches(it, item) } }
    if (removedItems.isNotEmpty()) {
        return FilterOutcome.Refused(
            removedItems.map { item ->
                ConfigProblem(
                    "filter.include.removed",
                    "The api '$apiId' keeps no operation for the include item '$item' once the document '${document ?: "(none)"}' has run.",
                    "Remove the item from `operations.include`, or choose a document that keeps it.",
                )
            },
        )
    }

    val kept = inDocument.filter { operation ->
        (entry.include.isEmpty() || entry.include.any { matches(operation, it) }) && entry.exclude.none { matches(operation, it) }
    }

    return FilterOutcome.Filtered(JsonObject(ir + ("operations" to JsonArray(kept))))
}

private fun isInDocument(documents: JsonObject, documentId: String?, operation: JsonObject): Boolean {
    if (documentId == null) return true

    val document = documents[documentId] as? JsonObject ?: return false
    if (document.stringAt("internal") == "exclude" && operation["internal"] == JsonPrimitive(true)) return false

    return operation.stringAt("surface") in (document.stringsAt("surfaces") ?: emptyList())
}

private fun matches(operation: JsonObject, item: String): Boolean =
    operation.stringAt("id") == item || item in (operation.stringsAt("tags") ?: emptyList())

private fun unknownSelectionProblems(
    apiId: String,
    documents: JsonObject,
    operations: List<JsonObject>,
    entry: AppConfigEntry,
): List<ConfigProblem> {
    val document = entry.document
    val documentProblems = if (document == null || document in documents) {
        emptyList()
    } else {
        listOf(
            ConfigProblem(
                "filter.document.unknown",
                "The api '$apiId' declares no document '$document' (${documents.keys.joinToString(", ").ifEmpty { "none declared" }}).",
                "Name one of the api's `documents` in `document`, or remove `document`.",
            ),
        )
    }

    val itemProblems = (entry.include + entry.exclude)
        .filter { item -> operations.none { matches(it, item) } }
        .map { item ->
            ConfigProblem(
                "filter.operation.unknown",
                "The api '$apiId' has no operation id or tag '$item'.",
                "Name an operation id or a tag of the api in `operations.include` or `operations.exclude`.",
            )
        }

    return documentProblems + itemProblems
}

