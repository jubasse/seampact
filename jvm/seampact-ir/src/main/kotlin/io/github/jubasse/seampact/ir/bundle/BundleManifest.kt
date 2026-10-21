package io.github.jubasse.seampact.ir.bundle

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** A manifest name and version: the contract, the compiler or a pack. */
public data class BundleNamedVersion(val name: String, val version: String)

/** One api of the bundle: its IR file and the IR version and revision it was written in. */
public data class BundleApi(val name: String, val file: String, val irVersion: Long, val irRevision: Long)

/** One listed file: its path, size and lowercase hexadecimal SHA-256. */
public data class BundleFile(val path: String, val size: Long, val sha256: String)

/**
 * The bundle manifest, `seampact-bundle.json` (ADR 0011). Only [files] and [integrity] are covered by the
 * integrity: the other members describe the bundle for messages and step 3, never for a trust decision.
 */
public data class BundleManifest(
    val formatVersion: Long,
    val contract: BundleNamedVersion,
    val apis: List<BundleApi>,
    val compiler: BundleNamedVersion,
    val packs: List<BundleNamedVersion>,
    val files: List<BundleFile>,
    val integrity: String,
) {
    internal companion object {
        /** The manifest of a document the schema accepted. */
        fun ofSchemaValid(document: JsonObject): BundleManifest = BundleManifest(
            formatVersion = document.long("formatVersion"),
            contract = namedVersion(document.getValue("contract")),
            apis = document.getValue("apis").jsonArray.map { api ->
                val member = api.jsonObject
                BundleApi(member.string("name"), member.string("file"), member.long("irVersion"), member.long("irRevision"))
            },
            compiler = namedVersion(document.getValue("compiler")),
            packs = document.getValue("packs").jsonArray.map(::namedVersion),
            files = document.getValue("files").jsonArray.map { file ->
                val member = file.jsonObject
                BundleFile(member.string("path"), member.long("size"), member.string("sha256"))
            },
            integrity = document.string("integrity"),
        )

        private fun namedVersion(element: JsonElement): BundleNamedVersion =
            BundleNamedVersion(element.jsonObject.string("name"), element.jsonObject.string("version"))

        private fun JsonObject.string(name: String): String = getValue(name).jsonPrimitive.content

        // The schema made it an integer; `1.0` is one too.
        private fun JsonObject.long(name: String): Long = getValue(name).jsonPrimitive.content.toBigDecimal().toLong()
    }
}
