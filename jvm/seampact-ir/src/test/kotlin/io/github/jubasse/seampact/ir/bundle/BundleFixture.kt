package io.github.jubasse.seampact.ir.bundle

import java.nio.file.Path
import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The valid bundle of the shared vectors (`packages/core/spec/vectors/bundle`), as a tarball and its integrity. */
internal object BundleFixture {
    val tarball: ByteArray by lazy {
        val file = Path.of(System.getProperty("seampact.repositoryRoot"), "packages/core/spec/vectors/bundle/vectors.json")
        val vectors = Json.parseToJsonElement(file.toFile().readText()).jsonObject
        val valid = vectors.getValue("archives").jsonArray.first { it.jsonObject.getValue("id").jsonPrimitive.content == "valid" }

        Base64.getDecoder().decode(valid.jsonObject.getValue("base64").jsonPrimitive.content)
    }

    val integrity: String by lazy {
        val directory = (BundleTarball.extract(tarball) as BundleArchiveExtraction.Extracted).directory
        try {
            checkNotNull((BundleVerifier.verify(directory, null, BundleChannel.RELEASE) as BundleVerifyResult.Refused).integrity)
        } finally {
            directory.toFile().deleteRecursively()
        }
    }

    /** The valid bundle written into [directory]. */
    fun writeInto(directory: Path) {
        val extracted = (BundleTarball.extract(tarball) as BundleArchiveExtraction.Extracted).directory
        try {
            extracted.toFile().copyRecursively(directory.toFile())
        } finally {
            extracted.toFile().deleteRecursively()
        }
    }
}
