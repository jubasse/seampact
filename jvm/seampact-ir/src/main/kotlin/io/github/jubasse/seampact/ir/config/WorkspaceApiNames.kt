package io.github.jubasse.seampact.ir.config

import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.serialization.json.JsonObject

private const val WORKSPACE_ENTRY = "workspace.yaml"

// A workspace with a single api may omit `workspace.yaml` (grammar section 1): its api file is then this one.
private const val SINGLE_API_ENTRY = "api.yaml"

/**
 * The api names a `path` source holds, read without compiling it, as the Node CLI's `workspace-api-names.ts`: the
 * `workspace.apis` of its `workspace.yaml`, or the `api.name` of its single api file. Null when the file cannot be
 * read or parsed, or does not name them: the source is then compiled, and the compiler says what is wrong with it.
 */
internal fun workspaceApiNames(directory: Path): List<String>? {
    val entry = listOf(WORKSPACE_ENTRY, SINGLE_API_ENTRY).map(directory::resolve).firstOrNull(Files::exists) ?: return null
    val text = try {
        Files.readString(entry)
    } catch (error: IOException) {
        return null
    }
    val value = (parseConfigText(text, entry.toString()) as? ConfigFileRead.Read)?.tree?.value as? JsonObject ?: return null

    if (entry.fileName.toString() == SINGLE_API_ENTRY) return listOfNotNull((value["api"] as? JsonObject)?.stringAt("name")).ifEmpty { null }

    return ((value["workspace"] as? JsonObject)?.get("apis") as? JsonObject)?.keys?.toList()
}
