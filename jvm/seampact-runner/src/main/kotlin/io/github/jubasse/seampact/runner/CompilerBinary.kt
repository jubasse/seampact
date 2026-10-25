package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.binary.BinaryFailure
import io.github.jubasse.seampact.ir.binary.BinaryFailureCode
import io.github.jubasse.seampact.ir.binary.BinaryInstall
import io.github.jubasse.seampact.ir.binary.BinaryInstaller
import io.github.jubasse.seampact.ir.binary.BinaryOverride
import io.github.jubasse.seampact.ir.binary.BinaryPin
import io.github.jubasse.seampact.ir.binary.BinaryPinResolution
import io.github.jubasse.seampact.ir.binary.BinaryPinning
import io.github.jubasse.seampact.ir.binary.BinaryPins
import io.github.jubasse.seampact.ir.binary.BinaryPinsRead
import io.github.jubasse.seampact.ir.binary.HostPlatform
import java.io.Serializable
import java.nio.file.Path

/** The build file's `binary { }` values (ADR 0010 "Pin"), as a task input. */
public data class BinarySettings(
    val version: String?,
    val sha256ByClassifier: Map<String, String>,
    val path: String?,
    val sha256: String?,
) : Serializable {
    /** The override these values write, or the reason they write none that can be pinned. */
    internal fun override(): OverrideRead {
        if (path != null && version != null) return OverrideRead.Refused(invalid("sets both `path` and `version`; the override is one or the other."))
        if (sha256 != null && path == null) return OverrideRead.Refused(invalid("sets `sha256` without `path`; `sha256` is the hash of your own build at `path`."))
        if (sha256ByClassifier.isNotEmpty() && version == null) {
            return OverrideRead.Refused(invalid("sets `sha256ByClassifier` without `version`; they are the hashes of that release."))
        }

        return when {
            path != null -> OverrideRead.Read(BinaryOverride.LocalPath(Path.of(path), sha256))
            version != null -> OverrideRead.Read(BinaryOverride.Version(version, sha256ByClassifier))
            else -> OverrideRead.Read(null)
        }
    }

    private fun invalid(reason: String) = BinaryFailure(
        BinaryFailureCode.PIN_INVALID,
        "The binary override $reason",
        "Give `version` with `sha256ByClassifier`, or `path` with `sha256`.",
    )

    private companion object {
        private const val serialVersionUID: Long = 1
    }
}

internal sealed interface OverrideRead {
    data class Read(val override: BinaryOverride?) : OverrideRead

    data class Refused(val failure: BinaryFailure) : OverrideRead
}

private const val PINS_RESOURCE = "/${BinaryPins.RESOURCE_NAME}"

/** The pins this runner jar embeds; null when it was built without a release `SHA256SUMS`. */
internal fun embeddedPins(): BinaryPinsRead? {
    val text = BuildTool::class.java.getResourceAsStream(PINS_RESOURCE)?.use { it.readBytes().decodeToString() } ?: return null

    return BinaryPins.readProperties(text)
}

/** The binary the build uses, from the embedded pins and the override, on this host. */
public fun pinBinary(settings: BinarySettings): BinaryPinResolution {
    val override = when (val read = settings.override()) {
        is OverrideRead.Read -> read.override
        is OverrideRead.Refused -> return BinaryPinResolution.Refused(read.failure)
    }
    val embedded = when (val read = embeddedPins()) {
        null -> null
        is BinaryPinsRead.Read -> read.pins
        is BinaryPinsRead.Refused -> if (override != null) null else return BinaryPinResolution.Refused(read.failure)
    }

    return BinaryPinning.pin(embedded, override, HostPlatform.current())
}

/**
 * Pins, resolves and installs the binary: a release artefact resolved by the build ([resolveArtefact], given the
 * pinned coordinates), or the consumer's own build. Its hash is checked before it is ever started.
 */
internal fun installBinary(
    settings: BinarySettings,
    resolveArtefact: (BinaryPin.Artifact) -> Path,
    cacheDirectory: Path,
    buildTool: BuildTool,
): BinaryInstall {
    val pin = when (val resolution = pinBinary(settings)) {
        is BinaryPinResolution.Pinned -> resolution.pin
        is BinaryPinResolution.Refused -> return BinaryInstall.Refused(resolution.failure)
    }
    val resolved = when (pin) {
        is BinaryPin.LocalFile -> pin.path
        is BinaryPin.Artifact -> try {
            resolveArtefact(pin)
        } catch (unresolved: ArtefactUnresolvedException) {
            return BinaryInstall.Refused(
                BinaryFailure(
                    BinaryFailureCode.ARTEFACT_UNRESOLVED,
                    "The build's repositories do not resolve the compiler binary ${pin.coordinates}: ${unresolved.message}",
                    buildTool.unresolvedBinaryFix,
                ),
            )
        }
    }

    return BinaryInstaller.install(resolved, pin, cacheDirectory)
}

/** The build could not resolve an artefact; [message] is the build tool's own reason. */
public class ArtefactUnresolvedException(message: String, cause: Throwable? = null) : Exception(message, cause)
