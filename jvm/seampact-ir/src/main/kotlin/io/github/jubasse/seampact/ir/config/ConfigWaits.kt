package io.github.jubasse.seampact.ir.config

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// The keys and value forms of ADR 0011 the JVM runner does not read yet, each with the work that brings it, as the
// Node CLI's `config-waits.ts`: each is refused by name (`config.key.waits`), never ignored. A target entry of
// another ecosystem is not a wait here: the JVM runner leaves it to its own runner.

internal data class ConfigWait(val path: KeyPath, val what: String, val bringer: String)

private const val SERVER_ENTRY_BRINGER = "the boundary runtime of the native server targets"

// A module link only arises across the apps of a monorepo, and no app links across apps yet.
private const val MODULE_LINK_BRINGER = "links across the apps of a monorepo, once an app needs one"

private val ENTRY_KEY_WAITS = listOf("mount", "access")

// The handler check of the boot check comes with the access hooks (ADR 0012).
private const val BOOT_CHECK_HANDLERS = "handlers"

/** Every key or value form of an app config that waits; [config] is the parsed value, not yet schema-checked. */
internal fun findConfigWaits(config: JsonElement): List<ConfigWait> {
    val targets = (config as? JsonObject)?.get("targets") as? JsonArray ?: return emptyList()

    return targets.flatMapIndexed { index, entry -> targetEntryWaits(entry, listOf("targets", index)) }
}

private fun targetEntryWaits(entry: JsonElement, path: KeyPath): List<ConfigWait> {
    if (entry !is JsonObject) return emptyList()

    val keyWaits = ENTRY_KEY_WAITS
        .filter { it in entry }
        .map { ConfigWait(path + it, "the key '$it'", SERVER_ENTRY_BRINGER) }
    val bootCheck = (entry["artefacts"] as? JsonObject)?.get("bootCheck") as? JsonObject
    val handlerWaits = if (bootCheck != null && BOOT_CHECK_HANDLERS in bootCheck) {
        listOf(
            ConfigWait(
                path + listOf("artefacts", "bootCheck", BOOT_CHECK_HANDLERS),
                "the boot check switch '$BOOT_CHECK_HANDLERS'",
                SERVER_ENTRY_BRINGER,
            ),
        )
    } else {
        emptyList()
    }
    val linkWaits = ((entry["link"] as? JsonObject) ?: JsonObject(emptyMap()))
        .filterValues { it is JsonObject }
        .keys
        .map { kind -> ConfigWait(path + listOf("link", kind), "a link with an explicit module specifier", MODULE_LINK_BRINGER) }

    return keyWaits + handlerWaits + linkWaits
}

/** Each waiting key as the problem `config.key.waits`. */
internal fun waitProblems(tree: ConfigTree, waits: List<ConfigWait>): List<KeyProblem> =
    waits.map { wait ->
        KeyProblem(
            wait.path,
            ConfigProblem(
                "config.key.waits",
                "${wait.what.replaceFirstChar { it.uppercaseChar() }} is not available yet; it comes with ${wait.bringer}.",
                "Remove it from the config for now.",
                tree.whereOf(wait.path),
            ),
        )
    }
