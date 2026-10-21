package io.github.jubasse.seampact.ir.bundle

import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64
import kotlin.io.path.readText
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// A bundle changed after it was pinned is refused, and the refusal names the file that differs, with both hashes,
// so a reviewer sees what was tampered with.
class TamperedBundleTest {
    private lateinit var directory: Path
    private lateinit var integrity: String

    @BeforeTest
    fun extractTheValidBundle() {
        val vectors = Json.parseToJsonElement(
            Path.of(System.getProperty("seampact.repositoryRoot"), "packages/core/spec/vectors/bundle/vectors.json").readText(),
        ).jsonObject
        val valid = vectors.getValue("archives").jsonArray.first { it.jsonObject.getValue("id").jsonPrimitive.content == "valid" }
        val extraction = BundleTarball.extract(Base64.getDecoder().decode(valid.jsonObject.getValue("base64").jsonPrimitive.content))
        check(extraction is BundleArchiveExtraction.Extracted) { "the valid tarball was refused: $extraction" }
        directory = extraction.directory

        val unpinned = BundleVerifier.verify(directory, null, BundleChannel.RELEASE)
        check(unpinned is BundleVerifyResult.Refused)
        integrity = checkNotNull(unpinned.integrity)
    }

    @AfterTest
    fun removeTheBundle() {
        directory.toFile().deleteRecursively()
    }

    @Test
    fun aChangedSourceIsNamedWithBothHashes() {
        val source = directory.resolve("sources/api.yaml")
        val bytes = Files.readAllBytes(source)
        bytes[0] = (bytes[0] + 1).toByte()
        Files.write(source, bytes)

        val result = BundleVerifier.verify(directory, integrity, BundleChannel.RELEASE)

        check(result is BundleVerifyResult.Refused)
        val failure = result.failures.single()
        assertEquals(BundleFailureCode.FILE_HASH, failure.code)
        assertEquals("sources/api.yaml", failure.file)
        assertEquals(sha256Hex(bytes), failure.actual)
        assertTrue(failure.message.contains("sources/api.yaml"))
    }

    @Test
    fun anAddedFileIsNamed() {
        Files.writeString(directory.resolve("sources/extra.yaml"), "extra: true\n")

        val result = BundleVerifier.verify(directory, integrity, BundleChannel.RELEASE)

        check(result is BundleVerifyResult.Refused)
        assertEquals(listOf(BundleFailureCode.FILE_UNLISTED to "sources/extra.yaml"), result.failures.map { it.code to it.file })
    }

    @Test
    fun aLinkIsRefusedByName() {
        Files.createSymbolicLink(directory.resolve("sources/linked.yaml"), directory.resolve("sources/api.yaml"))

        val result = BundleVerifier.verify(directory, integrity, BundleChannel.RELEASE)

        check(result is BundleVerifyResult.Refused)
        assertEquals(listOf(BundleFailureCode.FILE_TYPE to "sources/linked.yaml"), result.failures.map { it.code to it.file })
    }
}
