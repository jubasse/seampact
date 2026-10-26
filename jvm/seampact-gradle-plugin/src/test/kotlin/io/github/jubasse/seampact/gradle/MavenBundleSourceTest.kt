package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.runner.fixtures.ReferenceApp
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// A `maven` bundle source resolved through the build's repositories: from a `file:` repository it is a local
// source, refused under `allowLocal: false` (ADR 0011), and a bundle-only app never needs the compiler binary.
class MavenBundleSourceTest {
    @TempDir
    lateinit var directory: Path

    @Test
    fun aBundleFromAFileRepositoryIsALocalSource() {
        val app = SampleApp(directory)
        ReferenceApp.publishValidBundle(directory.resolve("repository"))
        app.write(
            "seampact.config.yaml",
            """
            allowLocal: false
            outDir: build/generated/sources/seampact/main
            openapi: none
            sources:
              contract: { maven: 'com.example:contract:1.0.0', integrity: 'sha256-AAAA' }
            targets:
              - { id: server, use: 'io.github.jubasse:seampact-spring-boot', api: contract/tasks, options: { package: com.example.api } }
            """,
        )
        app.writeBuildScript("repositories { maven { url = uri(\"repository\") } }")

        val refused = app.fail("seampactGenerate")

        assertTrue("bundle.source-local" in refused.output && "com.example:contract:1.0.0" in refused.output, refused.output)
        assertFalse("binary." in refused.output, "a bundle-only app never resolves the binary")
    }
}
