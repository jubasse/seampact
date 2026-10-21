package io.github.jubasse.seampact.ir.bundle

import kotlinx.serialization.json.JsonObject

// The manifest as a verifier reads it: at most `BUNDLE_MANIFEST_BYTES_MAX` bytes of UTF-8 JSON with no byte order
// mark, no reserved key and no key given twice in one object, valid under the manifest schema, then under the
// rules no schema states.

// A refusal lists at most this many problems, then how many more there are.
private const val LISTED_PROBLEM_LIMIT = 5

internal sealed interface ManifestRead {
    data class Read(val manifest: BundleManifest) : ManifestRead

    data class Refused(val failure: BundleFailure) : ManifestRead
}

/** The manifest of [bytes], or the failure naming why it is refused. */
internal fun readBundleManifest(bytes: ByteArray): ManifestRead {
    if (bytes.size > BUNDLE_MANIFEST_BYTES_MAX) return ManifestRead.Refused(manifestTooLarge(bytes.size.toLong()))

    val text = utf8Text(bytes) ?: return invalidManifest(listOf("is not UTF-8 text"))

    val parsed = parseUntrustedJson(text)
    if (parsed is UntrustedJson.Refused) return invalidManifest(listOf(parsed.problem))
    val document = (parsed as UntrustedJson.Parsed).value

    val duplicateAt = duplicateKeyPointer(text)
    if (duplicateAt != null) return invalidManifest(listOf("gives the key at ${quoted(duplicateAt)} twice in one object"))

    val schemaProblems = ManifestSchema.problems(document)
    if (schemaProblems.isNotEmpty()) return invalidManifest(schemaProblems)

    // The schema's root type is object.
    val manifest = BundleManifest.ofSchemaValid(document as JsonObject)
    val ruleProblems = bundleManifestRuleProblems(manifest)
    if (ruleProblems.isNotEmpty()) return invalidManifest(ruleProblems)

    return ManifestRead.Read(manifest)
}

/** The failure of a manifest over `BUNDLE_MANIFEST_BYTES_MAX`, refused before it is read. */
internal fun manifestTooLarge(size: Long): BundleFailure = BundleFailure(
    code = BundleFailureCode.MANIFEST_TOO_LARGE,
    message = "'$BUNDLE_MANIFEST_FILE' holds $size bytes, over the cap of $BUNDLE_MANIFEST_BYTES_MAX.",
    fix = "Check that the source names a seampact bundle; a manifest this large is not one.",
    file = BUNDLE_MANIFEST_FILE,
    expected = BUNDLE_MANIFEST_BYTES_MAX.toString(),
    actual = size.toString(),
)

private fun invalidManifest(problems: List<String>): ManifestRead = ManifestRead.Refused(
    BundleFailure(
        code = BundleFailureCode.MANIFEST_INVALID,
        message = "'$BUNDLE_MANIFEST_FILE' is not a valid manifest: ${listedProblems(problems, LISTED_PROBLEM_LIMIT)}.",
        fix = REBUILD_FIX,
        file = BUNDLE_MANIFEST_FILE,
    ),
)
