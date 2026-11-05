package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.binary.BinaryPins
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

// The jar embeds a pin exactly when its build names a release SHA256SUMS, so an unpinned build after a pinned one
// keeps no stale pin.
class BinaryPinsResourceTest {
    @Test
    fun `the pin resource is present only when the build names a SHA256SUMS`() {
        val pinExpected = System.getProperty(PIN_EXPECTED_PROPERTY).toBoolean()
        val pinPresent = javaClass.classLoader.getResource(BinaryPins.RESOURCE_NAME) != null

        assertEquals(pinExpected, pinPresent, "${BinaryPins.RESOURCE_NAME} on the classpath")
    }

    private companion object {
        const val PIN_EXPECTED_PROPERTY = "seampact.binaryPinExpected"
    }
}
