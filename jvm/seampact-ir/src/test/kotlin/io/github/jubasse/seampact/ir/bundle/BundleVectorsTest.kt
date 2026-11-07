package io.github.jubasse.seampact.ir.bundle

import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// The shared bundle vectors every verifier must pass (`packages/core/spec/vectors/bundle`): each directory vector
// through the pinned-bundle check, each archive vector through the tarball reader. Every recorded field is
// compared; messages never are.
class BundleVectorsTest {
    private val vectors: JsonObject = Json.parseToJsonElement(
        Path.of(System.getProperty("seampact.repositoryRoot"), "packages/core/spec/vectors/bundle/vectors.json").readText(),
    ).jsonObject

    @Test
    fun directoryVectorsGiveTheExpectedOutcome() {
        val cases = vectors.getValue("directories").jsonArray
        assertTrue(cases.isNotEmpty())

        for (case in cases) {
            val vector = case.jsonObject
            val directory = writeDirectory(vector)
            try {
                val pin = vector.getValue("pin").let { if (it is JsonNull) null else it.jsonPrimitive.content }
                val channel = BundleChannel.valueOf(vector.getValue("channel").jsonPrimitive.content.uppercase())
                val outcome = when (val result = BundleVerifier.verify(directory, pin, channel)) {
                    is BundleVerifyResult.Verified -> Outcome(true, result.integrity, emptyList())
                    is BundleVerifyResult.Refused -> Outcome(false, result.integrity, result.failures.map(::recorded))
                }

                assertEquals(expectedOutcome(vector, "integrity"), outcome, vector.getValue("id").jsonPrimitive.content)
            } finally {
                directory.toFile().deleteRecursively()
            }
        }
    }

    @Test
    fun archiveVectorsGiveTheExpectedOutcome() {
        val cases = vectors.getValue("archives").jsonArray
        assertTrue(cases.isNotEmpty())

        for (case in cases) {
            val vector = case.jsonObject
            val tarball = Base64.getDecoder().decode(vector.getValue("base64").jsonPrimitive.content)
            val outcome = when (val read = BundleTarball.read(tarball)) {
                is BundleArchiveRead.Read -> ArchiveOutcome(true, read.entries.map { it.path }, emptyList())
                is BundleArchiveRead.Refused -> ArchiveOutcome(false, emptyList(), read.failures.map(::recorded))
            }
            val expected = vector.getValue("expected").jsonObject

            assertEquals(
                ArchiveOutcome(
                    expected.getValue("ok").jsonPrimitive.boolean,
                    expected.getValue("paths").jsonArray.map { it.jsonPrimitive.content },
                    expected.getValue("failures").jsonArray.map { it.jsonObject.toRecorded() },
                ),
                outcome,
                vector.getValue("id").jsonPrimitive.content,
            )
        }
    }

    @Test
    fun theValidArchiveExtractsToAVerifiedBundle() {
        val valid = vectors.getValue("archives").jsonArray.first { it.jsonObject.getValue("id").jsonPrimitive.content == "valid" }
        val tarball = Base64.getDecoder().decode(valid.jsonObject.getValue("base64").jsonPrimitive.content)
        val extraction = BundleTarball.extract(tarball)
        check(extraction is BundleArchiveExtraction.Extracted) { "the valid tarball was refused: $extraction" }

        try {
            val unpinned = BundleVerifier.verify(extraction.directory, null, BundleChannel.RELEASE)
            check(unpinned is BundleVerifyResult.Refused)
            val integrity = checkNotNull(unpinned.integrity)

            val pinned = BundleVerifier.verify(extraction.directory, integrity, BundleChannel.RELEASE)
            check(pinned is BundleVerifyResult.Verified) { "the pinned bundle was refused: $pinned" }
            assertEquals(pinned.manifest.apis.map { it.name }.toSet(), pinned.irs.keys)
        } finally {
            extraction.directory.toFile().deleteRecursively()
        }
    }

    private data class Recorded(val code: String, val file: String?, val expected: String?, val actual: String?)

    private data class Outcome(val ok: Boolean, val integrity: String?, val failures: List<Recorded>)

    private data class ArchiveOutcome(val ok: Boolean, val paths: List<String>, val failures: List<Recorded>)

    private fun recorded(failure: BundleFailure) = Recorded(failure.code.code, failure.file, failure.expected, failure.actual)

    private fun JsonObject.toRecorded() = Recorded(
        getValue("code").jsonPrimitive.content,
        optional("file"),
        optional("expected"),
        optional("actual"),
    )

    private fun JsonObject.optional(name: String): String? = (get(name) as JsonPrimitive?)?.content

    private fun expectedOutcome(vector: JsonObject, integrityKey: String): Outcome {
        val expected = vector.getValue("expected").jsonObject
        val integrity: JsonElement = expected.getValue(integrityKey)

        return Outcome(
            expected.getValue("ok").jsonPrimitive.boolean,
            if (integrity is JsonNull) null else integrity.jsonPrimitive.content,
            expected.getValue("failures").jsonArray.map { it.jsonObject.toRecorded() },
        )
    }

    private fun writeDirectory(vector: JsonObject): Path {
        val directory = Files.createTempDirectory("seampact-bundle-vector-")
        for (file in vector.getValue("files").jsonArray) {
            val target = directory.resolve(file.jsonObject.getValue("path").jsonPrimitive.content)
            Files.createDirectories(target.parent)
            Files.write(target, Base64.getDecoder().decode(file.jsonObject.getValue("base64").jsonPrimitive.content))
        }

        return directory
    }
}
