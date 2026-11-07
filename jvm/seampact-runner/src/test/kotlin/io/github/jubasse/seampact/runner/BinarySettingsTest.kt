package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.binary.BinaryFailureCode
import io.github.jubasse.seampact.ir.binary.BinaryPin
import io.github.jubasse.seampact.ir.binary.BinaryPinResolution
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

// The build file's `binary { }` values (ADR 0010 "Pin"): each inconsistent combination is refused by name.
class BinarySettingsTest {
    private fun refusalOf(settings: BinarySettings): String {
        val resolution = pinBinary(settings)

        assertIs<BinaryPinResolution.Refused>(resolution)
        assertEquals(BinaryFailureCode.PIN_INVALID, resolution.failure.code)
        assertEquals("Give `version` with `sha256ByClassifier`, or `path` with `sha256`.", resolution.failure.fix)

        return resolution.failure.message
    }

    @Test
    fun refusesAPathAndAVersionTogether() {
        assertEquals(
            "The binary override sets both `path` and `version`; the override is one or the other.",
            refusalOf(BinarySettings("1.0.0", emptyMap(), "/opt/seampact", null)),
        )
    }

    @Test
    fun refusesAHashWithoutAPath() {
        assertEquals(
            "The binary override sets `sha256` without `path`; `sha256` is the hash of your own build at `path`.",
            refusalOf(BinarySettings(null, emptyMap(), null, "abc")),
        )
    }

    @Test
    fun refusesClassifierHashesWithoutAVersion() {
        assertEquals(
            "The binary override sets `sha256ByClassifier` without `version`; they are the hashes of that release.",
            refusalOf(BinarySettings(null, mapOf("linux-x86_64" to "abc"), null, null)),
        )
    }

    @Test
    fun pinsTheConsumersOwnBuildAtThePathItNames() {
        val resolution = pinBinary(BinarySettings(null, emptyMap(), "/opt/seampact", "a".repeat(64)))

        assertIs<BinaryPinResolution.Pinned>(resolution)
        val pin = resolution.pin
        assertIs<BinaryPin.LocalFile>(pin)
        assertEquals("/opt/seampact", pin.path.toString())
    }
}
