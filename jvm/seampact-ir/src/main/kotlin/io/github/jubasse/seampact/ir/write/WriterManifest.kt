package io.github.jubasse.seampact.ir.write

import java.nio.file.Files
import java.nio.file.Path
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// What the writer keeps in a target's output directory (ADR 0015 "Writing files"), as `manifest.ts`: the target
// that owns the directory, and each file it generated with the SHA-256 of its bytes, in code-unit order of path.
// The Node writer and this one read and write the same file.

internal sealed interface ManifestRead {
    data class Read(val owner: String?, val hashByPath: Map<String, String>) : ManifestRead

    data class Invalid(val reason: String) : ManifestRead
}

private val SHA256_HEX = Regex("^[0-9a-f]{64}$")

/** The manifest of [rootDir]; a missing one is an empty manifest without an owner (a first run). */
internal fun readManifest(rootDir: Path): ManifestRead {
    val file = rootDir.resolve(MANIFEST_FILE_NAME)
    if (!Files.exists(file)) return ManifestRead.Read(null, emptyMap())

    val parsed = try {
        Json.parseToJsonElement(Files.readString(file))
    } catch (error: SerializationException) {
        return ManifestRead.Invalid("it is not JSON (${error.message})")
    }

    val files = (parsed as? JsonObject)?.get("files") as? JsonArray ?: return ManifestRead.Invalid("it has no `files` array")
    val owner = (parsed["owner"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return ManifestRead.Invalid("it has no `owner` target id")
    val hashByPath = LinkedHashMap<String, String>()

    for (entry in files) {
        val path = ((entry as? JsonObject)?.get("path") as? JsonPrimitive)?.takeIf { it.isString }?.content
        val sha256 = ((entry as? JsonObject)?.get("sha256") as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (path == null || sha256 == null) return ManifestRead.Invalid("an entry is not `{ path, sha256 }` strings")
        if (!SHA256_HEX.matches(sha256)) return ManifestRead.Invalid("the hash of '$path' is not a SHA-256 hex digest")
        if (path in hashByPath) return ManifestRead.Invalid("'$path' is listed twice")

        val unsafe = unsafePathReason(path)
        if (unsafe != null) return ManifestRead.Invalid("the path '$path' is unsafe: $unsafe")
        hashByPath[path] = sha256
    }

    return ManifestRead.Read(owner, hashByPath)
}

/** The manifest's text, byte for byte the Node writer's `JSON.stringify(..., null, 2)` and a final newline. */
internal fun serializeManifest(owner: String, hashByPath: Map<String, String>): String {
    val entries = hashByPath.entries.sortedWith { left, right -> left.key.compareTo(right.key) }
    val files = entries.joinToString(",\n") { (path, sha256) ->
        "    {\n      \"path\": ${jsonString(path)},\n      \"sha256\": ${jsonString(sha256)}\n    }"
    }
    val filesBlock = if (entries.isEmpty()) "[]" else "[\n$files\n  ]"

    return "{\n  \"owner\": ${jsonString(owner)},\n  \"files\": $filesBlock\n}\n"
}

private fun jsonString(value: String): String = JsonPrimitive(value).toString()
