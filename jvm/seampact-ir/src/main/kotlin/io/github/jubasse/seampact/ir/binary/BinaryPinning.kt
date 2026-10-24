package io.github.jubasse.seampact.ir.binary

import java.nio.file.Path

/** A consumer's override of the embedded pins, from the build file (ADR 0011 "The app config", last rule). */
public sealed interface BinaryOverride {
    /** Another compiler version, with the SHA-256 of its binary on every platform, by classifier. */
    public data class Version(val version: String, val sha256ByClassifier: Map<String, String>) : BinaryOverride

    /** A binary on disk, the consumer's own build, with its SHA-256; [sha256] null when the build file gives none. */
    public data class LocalPath(val path: Path, val sha256: String?) : BinaryOverride
}

/** The binary to use and the SHA-256 it must have before it is ever started. */
public sealed interface BinaryPin {
    public val sha256: String

    /** The release artefact of [platform] at [version], resolved through the build's own repositories. */
    public data class Artifact(val platform: BinaryPlatform, val version: String, override val sha256: String) : BinaryPin {
        public val coordinates: String get() = platform.coordinates(version)
    }

    /** The consumer's own binary. */
    public data class LocalFile(val path: Path, override val sha256: String) : BinaryPin
}

/** The outcome of [BinaryPinning.pin]. */
public sealed interface BinaryPinResolution {
    public data class Pinned(val pin: BinaryPin) : BinaryPinResolution

    public data class Refused(val failure: BinaryFailure) : BinaryPinResolution
}

/**
 * Chooses the binary a build uses: the embedded pins, or the consumer's override, never an override without a
 * hash (`binary.pin-missing`). A release artefact also needs a supported host (`binary.platform-unsupported`); a
 * local path does not, since it is how a consumer on another platform brings its own build.
 */
public object BinaryPinning {
    private const val OVERRIDE_SOURCE = "The binary version override"

    /** [embedded] is null when the plugin was built without a release `SHA256SUMS`: only an override pins then. */
    public fun pin(embedded: BinaryPins?, override: BinaryOverride?, host: HostPlatform): BinaryPinResolution {
        val pins = when (override) {
            is BinaryOverride.LocalPath -> return localFile(override)
            is BinaryOverride.Version -> when (val read = BinaryPins.pinsOf(override.version, override.sha256ByClassifier, OVERRIDE_SOURCE)) {
                is BinaryPinsRead.Read -> read.pins
                is BinaryPinsRead.Refused -> return BinaryPinResolution.Refused(read.failure)
            }
            null -> embedded ?: return BinaryPinResolution.Refused(
                BinaryFailure(
                    BinaryFailureCode.PIN_MISSING,
                    "This build plugin embeds no compiler pin: it was built without a release SHA256SUMS, so it has no binary to run.",
                    "Pin the binary in the build file: a release version with the SHA-256 of each platform, or a path to your own build with its SHA-256.",
                ),
            )
        }

        return when (val classification = PlatformClassifier.classify(host)) {
            is PlatformClassification.Supported -> BinaryPinResolution.Pinned(
                BinaryPin.Artifact(classification.platform, pins.version, pins.sha256ByPlatform.getValue(classification.platform)),
            )
            is PlatformClassification.Unsupported -> BinaryPinResolution.Refused(classification.failure)
        }
    }

    private fun localFile(override: BinaryOverride.LocalPath): BinaryPinResolution {
        val sha256 = override.sha256
        if (sha256 == null) {
            return BinaryPinResolution.Refused(
                BinaryFailure(
                    BinaryFailureCode.PIN_MISSING,
                    "The binary path '${override.path}' is given without its SHA-256; an unpinned binary is never run.",
                    "Give the binary's SHA-256 beside its path (`sha256sum <path>` prints it).",
                ),
            )
        }

        if (!SHA_256_HEX.matches(sha256)) {
            return BinaryPinResolution.Refused(
                BinaryFailure(
                    BinaryFailureCode.PIN_INVALID,
                    "The SHA-256 of the binary path '${override.path}' is not 64 lowercase hexadecimal digits.",
                    "Give the binary's SHA-256 as `sha256sum <path>` prints it.",
                    actual = sha256,
                ),
            )
        }

        return BinaryPinResolution.Pinned(BinaryPin.LocalFile(override.path, sha256))
    }
}
