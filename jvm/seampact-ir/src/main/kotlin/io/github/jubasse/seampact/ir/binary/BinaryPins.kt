package io.github.jubasse.seampact.ir.binary

import java.io.StringReader
import java.util.Properties

/**
 * The binary a plugin release pins (ADR 0010, "Distribution and pinning"): one compiler [version] and the SHA-256 of
 * its binary on every platform. A plugin jar embeds it as [RESOURCE_NAME], written at plugin build time from the
 * release `SHA256SUMS`; a consumer overrides it with a version and all its hashes, or with a local path and one hash.
 */
public data class BinaryPins(val version: String, val sha256ByPlatform: Map<BinaryPlatform, String>) {
    public companion object {
        /** The resource a plugin jar embeds. */
        public const val RESOURCE_NAME: String = "seampact-binaries.properties"

        private const val VERSION_KEY = "version"
        private const val HASH_KEY_PREFIX = "sha256."

        /** The pins of an embedded [RESOURCE_NAME] text. */
        public fun readProperties(text: String): BinaryPinsRead {
            val properties = Properties()
            properties.load(StringReader(text))
            val keys = properties.stringPropertyNames()

            val unknown = keys.filter { it != VERSION_KEY && !it.startsWith(HASH_KEY_PREFIX) }.sorted()
            if (unknown.isNotEmpty()) {
                return refused(BinaryFailureCode.PIN_INVALID, "$RESOURCE_NAME holds the unknown keys ${unknown.joinToString(", ")}.")
            }

            val hashes = keys.filter { it.startsWith(HASH_KEY_PREFIX) }
                .associate { it.removePrefix(HASH_KEY_PREFIX) to properties.getProperty(it) }

            return pinsOf(properties.getProperty(VERSION_KEY), hashes, RESOURCE_NAME)
        }

        /** The pins of [version] from a release `SHA256SUMS` text, `<sha256>  <asset name>` per line. */
        public fun fromSha256Sums(version: String, text: String): BinaryPinsRead {
            val hashes = mutableMapOf<String, String>()

            for (line in text.lines().filter { it.isNotEmpty() }) {
                val hash = line.substringBefore("  ")
                val assetName = line.substringAfter("  ", missingDelimiterValue = "")
                val platform = BinaryPlatform.ofAssetName(assetName)
                    ?: return refused(BinaryFailureCode.PIN_INVALID, "${BinaryPlatform.MANIFEST_FILE_NAME} lists '$assetName', no binary of the release.")
                hashes[platform.classifier] = hash
            }

            return pinsOf(version, hashes, BinaryPlatform.MANIFEST_FILE_NAME)
        }

        /** The pins of a version and its hashes by classifier, every platform's hash given, checked. */
        public fun pinsOf(version: String?, sha256ByClassifier: Map<String, String>, source: String): BinaryPinsRead {
            if (version.isNullOrEmpty() || !VERSION.matches(version)) {
                return refused(BinaryFailureCode.PIN_INVALID, "$source gives no compiler version, or one with a space or a control character.")
            }

            val unknown = sha256ByClassifier.keys.filter { BinaryPlatform.ofClassifier(it) == null }.sorted()
            if (unknown.isNotEmpty()) {
                return refused(BinaryFailureCode.PIN_INVALID, "$source pins the unknown classifiers ${unknown.joinToString(", ")}.")
            }

            val missing = BinaryPlatform.entries.map { it.classifier }.filter { it !in sha256ByClassifier }
            if (missing.isNotEmpty()) {
                return refused(BinaryFailureCode.PIN_MISSING, "$source pins no SHA-256 for ${missing.joinToString(", ")} of version $version.")
            }

            val malformed = sha256ByClassifier.filterValues { !SHA_256_HEX.matches(it) }.keys.sorted()
            if (malformed.isNotEmpty()) {
                return refused(BinaryFailureCode.PIN_INVALID, "$source pins a SHA-256 that is not 64 lowercase hexadecimal digits for ${malformed.joinToString(", ")}.")
            }

            val pins = BinaryPlatform.entries.associateWith { sha256ByClassifier.getValue(it.classifier) }

            return BinaryPinsRead.Read(BinaryPins(version, pins))
        }

        private fun refused(code: BinaryFailureCode, message: String): BinaryPinsRead = BinaryPinsRead.Refused(
            BinaryFailure(code, message, "Give the compiler version and the SHA-256 of each of its binaries, as the release SHA256SUMS lists them."),
        )
    }

    /** The [RESOURCE_NAME] text of these pins, the same bytes for the same pins. */
    public fun toProperties(): String = buildString {
        append("$VERSION_KEY=$version\n")
        for (platform in BinaryPlatform.entries) append("$HASH_KEY_PREFIX${platform.classifier}=${sha256ByPlatform.getValue(platform)}\n")
    }
}

/** The outcome of reading pins. */
public sealed interface BinaryPinsRead {
    public data class Read(val pins: BinaryPins) : BinaryPinsRead

    public data class Refused(val failure: BinaryFailure) : BinaryPinsRead
}

internal val SHA_256_HEX = Regex("[0-9a-f]{64}")

// Printable ASCII with no space, as a release version is.
private val VERSION = Regex("[!-~]+")
