package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.ir.binary.BinaryPlatform
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.DisabledOnOs
import org.junit.jupiter.api.condition.OS
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.BasicFileAttributes
import kotlin.io.path.createDirectories
import kotlin.io.path.deleteIfExists
import kotlin.io.path.exists
import kotlin.io.path.writeText
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// A version pin resolves the `seampact-compiler` classifier artefact through the build's own repositories, here a
// file Maven repository (ADR 0010 section 8, The JVM channels): an artefact with another hash never starts, one the repositories do
// not hold is refused by name, the pinned one runs, and the next build reuses its cached copy.
@DisabledOnOs(OS.WINDOWS, disabledReason = "the stub binary is a shell script")
class BinaryArtefactTest {
    @TempDir
    lateinit var directory: Path

    @TempDir
    lateinit var repository: Path

    @Test
    fun aPinnedArtefactOfTheBuildRepositoriesRunsAndIsCached() {
        val app = SampleApp(directory)
        app.write("seampact.config.yaml", SampleApp.REFERENCE_CONFIG)
        publishStub(app.stubBinary, VERSION)
        val stubSha256 = SampleApp.sha256Of(app.stubBinary)

        app.writeBuildScript(versionPin(VERSION, OTHER_SHA256), extraRepositories = fileRepository())
        val mismatch = app.fail("seampactGenerate")
        assertTrue("binary.hash-mismatch" in mismatch.output, mismatch.output)
        assertFalse(app.stubMarker.exists(), "an artefact with another hash is never started")

        app.writeBuildScript(versionPin(UNPUBLISHED_VERSION, stubSha256), extraRepositories = fileRepository())
        val unresolved = app.fail("seampactGenerate")
        assertTrue("binary.artefact-unresolved" in unresolved.output && UNPUBLISHED_VERSION in unresolved.output, unresolved.output)

        app.writeBuildScript(versionPin(VERSION, stubSha256), extraRepositories = fileRepository())
        app.run("seampactGenerate")
        assertTrue(app.stubMarker.exists())
        val cached = cachedCopy(stubSha256)
        val firstCopy = Files.readAttributes(cached, BasicFileAttributes::class.java).fileKey()

        app.stubMarker.deleteIfExists()
        app.run("seampactGenerate", "--rerun-tasks")
        assertTrue(app.stubMarker.exists())
        assertEquals(firstCopy, Files.readAttributes(cached, BasicFileAttributes::class.java).fileKey(), "the cached copy is reused")
    }

    // A POM and the stub under every classifier, as a release publishes them.
    private fun publishStub(stub: Path, version: String) {
        val module = repository.resolve("io/github/jubasse/${BinaryPlatform.ARTIFACT_ID}/$version").createDirectories()
        module.resolve("${BinaryPlatform.ARTIFACT_ID}-$version.pom").writeText(
            """
            <project xmlns="http://maven.apache.org/POM/4.0.0">
              <modelVersion>4.0.0</modelVersion>
              <groupId>${BinaryPlatform.GROUP_ID}</groupId>
              <artifactId>${BinaryPlatform.ARTIFACT_ID}</artifactId>
              <version>$version</version>
              <packaging>pom</packaging>
            </project>
            """.trimIndent(),
        )

        for (platform in BinaryPlatform.entries) {
            Files.copy(stub, module.resolve("${BinaryPlatform.ARTIFACT_ID}-$version-${platform.classifier}.${BinaryPlatform.ARTIFACT_TYPE}"))
        }
    }

    private fun fileRepository(): String = "maven { url = uri(\"${repository.toUri()}\") }"

    private fun versionPin(version: String, sha256: String): String {
        val hashes = BinaryPlatform.entries.joinToString(", ") { "\"${it.classifier}\" to \"$sha256\"" }

        return "seampact {\nbinary {\nversion = \"$version\"\nsha256ByClassifier.set(mapOf($hashes))\n}\n}"
    }

    // The Gradle user home of the test builds holds the binary cache (ADR 0010 "Cache").
    private fun cachedCopy(sha256: String): Path {
        val entry = Path.of(System.getProperty("seampact.testKitDirectory"), "caches", "seampact", "binaries", sha256)
        val copies = Files.list(entry).use { files -> files.filter { !it.fileName.toString().startsWith(".") }.toList() }

        return copies.single()
    }

    private companion object {
        const val VERSION = "1.2.3"
        const val UNPUBLISHED_VERSION = "9.9.9"
        val OTHER_SHA256 = "0".repeat(64)
    }
}
