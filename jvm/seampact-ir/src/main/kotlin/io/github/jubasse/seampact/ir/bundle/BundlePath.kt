package io.github.jubasse.seampact.ir.bundle

import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// The portable-path rule of a bundle file (`schemas/bundle/README.md`, "Paths"): relative to the bundle root, under
// `sources/` or `ir/`, each segment of `[A-Za-z0-9._@+-]`, not ending in `.` and not a Windows device name before
// its first `.`. The named checks say what is wrong; the schema's `$defs/path` patterns stay the one source.

private val TOP_DIRECTORIES = listOf(BUNDLE_SOURCES_DIRECTORY, BUNDLE_IR_DIRECTORY)
private val SEGMENT_CHARACTER = Regex("[A-Za-z0-9._@+-]")
private val DEVICE_STEM = Regex("con|prn|aux|nul|com[0-9]|lpt[0-9]")

private val pathPattern: String by lazy { ManifestSchema.pathDefinition.getValue("pattern").jsonPrimitive.content }
private val devicePattern: String by lazy {
    ManifestSchema.pathDefinition.getValue("not").jsonObject.getValue("pattern").jsonPrimitive.content
}
private val pathMaxLength: Int by lazy { ManifestSchema.pathDefinition.getValue("maxLength").jsonPrimitive.content.toInt() }

/** Why [path] is not a portable bundle path, or null when it is one. */
internal fun bundlePathProblem(path: String): String? {
    if (path.length > pathMaxLength) return "is longer than $pathMaxLength characters"

    val segments = path.split("/")
    if (segments.first() !in TOP_DIRECTORIES || segments.size < 2) return "is not a file under sources/ or ir/"

    for (segment in segments) {
        val problem = segmentProblem(segment)
        if (problem != null) return problem
    }

    if (!ManifestSchema.matches(pathPattern, path) || ManifestSchema.matches(devicePattern, path)) {
        return "does not match the portable path pattern"
    }

    return null
}

private fun segmentProblem(segment: String): String? {
    if (segment == "" || segment == "." || segment == "..") return "has an empty, '.' or '..' segment"

    val unportable = segment.codePoints().toArray().firstOrNull { !SEGMENT_CHARACTER.matches(String(Character.toChars(it))) }
    if (unportable != null) {
        val hex = unportable.toString(16).uppercase().padStart(4, '0')
        return "holds U+$hex, outside the portable characters A-Z a-z 0-9 . _ @ + -"
    }

    if (segment.endsWith(".")) return "has the segment '$segment', ending in '.' (Windows drops it)"

    val stem = segment.substringBefore('.')
    if (DEVICE_STEM.matches(bundlePathFold(stem))) {
        return "has the segment '$segment', a Windows device name (CON, PRN, AUX, NUL, COM0-9, LPT0-9)"
    }

    return null
}

/** The key two paths share when they differ only in ASCII letter case (a case-insensitive file system). */
internal fun bundlePathFold(path: String): String =
    buildString(path.length) { for (character in path) append(if (character in 'A'..'Z') character.lowercaseChar() else character) }

/** Code-unit order, never locale order: Kotlin's `String.compareTo`. */
internal fun compareBundlePaths(left: String, right: String): Int = left.compareTo(right)
