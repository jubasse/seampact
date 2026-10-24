package io.github.jubasse.seampact.gradle

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.util.Base64
import kotlin.io.path.createDirectories
import kotlin.io.path.readText
import kotlin.io.path.writeBytes
import kotlin.io.path.writeText
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
        publishValidBundle(directory.resolve("repository"))
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

    // The valid bundle of the shared vectors, as `com.example:contract:1.0.0@tgz` with its POM.
    private fun publishValidBundle(repository: Path) {
        val vectors = Path.of(System.getProperty("seampact.repositoryRoot"), "packages/core/spec/vectors/bundle/vectors.json")
        val valid = Json.parseToJsonElement(vectors.readText()).jsonObject.getValue("archives").jsonArray
            .first { it.jsonObject.getValue("id").jsonPrimitive.content == "valid" }.jsonObject
        val version = repository.resolve("com/example/contract/1.0.0").createDirectories()

        version.resolve("contract-1.0.0.tgz").writeBytes(Base64.getDecoder().decode(valid.getValue("base64").jsonPrimitive.content))
        version.resolve("contract-1.0.0.pom").writeText(
            """
            <project xmlns="http://maven.apache.org/POM/4.0.0">
              <modelVersion>4.0.0</modelVersion>
              <groupId>com.example</groupId>
              <artifactId>contract</artifactId>
              <version>1.0.0</version>
              <packaging>tgz</packaging>
            </project>
            """.trimIndent(),
        )
    }
}
