package io.github.jubasse.seampact.gradle

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// The `binary { }` override (ADR 0010 "Pin"): a binary whose hash differs is never started, an override without
// its hash or with both forms is refused, a plugin built without pins runs no binary unless the build pins one,
// and SEAMPACT_ALLOW_LOCAL=false refuses a `path` source before any binary is resolved.
class BinaryOverrideTest {
    @TempDir
    lateinit var directory: Path

    @Test
    fun onlyAPinnedBinaryRuns() {
        val app = SampleApp(directory)
        app.write("seampact.config.yaml", SampleApp.REFERENCE_CONFIG)

        app.writeBuildScript("seampact {\n${app.stubBinaryBlock("0".repeat(64))}\n}")
        val mismatch = app.fail("seampactGenerate")
        assertTrue("binary.hash-mismatch" in mismatch.output, mismatch.output)
        assertFalse(app.stubMarker.exists(), "a binary with another hash is never started")

        app.writeBuildScript("seampact { binary { path = file(\"stub-seampact\") } }")
        val unpinned = app.fail("seampactGenerate")
        assertTrue("binary.pin-missing" in unpinned.output, unpinned.output)

        app.writeBuildScript("seampact {\n${app.stubBinaryBlock()}\nbinary { version = \"1.0.0\" }\n}")
        val both = app.fail("seampactGenerate")
        assertTrue("binary.pin-invalid" in both.output, both.output)

        // This plugin is built without a release SHA256SUMS, so it embeds no pin.
        app.writeBuildScript("")
        val noPin = app.fail("seampactGenerate")
        assertTrue("embeds no compiler pin" in noPin.output, noPin.output)

        app.writeBuildScript("seampact {\n${app.stubBinaryBlock()}\n}")
        val refused = app.fail("seampactGenerate", environment = mapOf(SampleApp.ALLOW_LOCAL_VARIABLE to "false"))
        assertTrue("config.source.local" in refused.output && "SEAMPACT_ALLOW_LOCAL=false" in refused.output, refused.output)
        assertFalse(app.stubMarker.exists())

        app.run("seampactGenerate")
        assertTrue(app.stubMarker.exists())
    }
}
