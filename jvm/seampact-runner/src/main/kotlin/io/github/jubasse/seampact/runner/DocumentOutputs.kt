package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.config.AppConfig
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.nio.file.Path

/**
 * Where the binary writes an app's seampact OpenAPI documents, for the build to declare them as outputs (ADR 0011
 * "Which OpenAPI documents exist"): without `openapi`, the `openapi` directory beside the app config; with documents
 * listed, each document's file and the `.seampact-manifest.json` of its directory. The app config was checked
 * against its schema when it was read, so each listed document is a path or an object with one.
 */
internal data class DocumentOutputs(val files: List<Path>, val directories: List<Path>) {
    companion object {
        val NONE: DocumentOutputs = DocumentOutputs(emptyList(), emptyList())

        private const val DEFAULT_DOCUMENT_DIRECTORY = "openapi"
        private const val MANIFEST_FILE_NAME = ".seampact-manifest.json"
        private const val PATH_KEY = "path"

        fun of(config: AppConfig): DocumentOutputs {
            val listed = config.openapi as? JsonObject
                ?: return DocumentOutputs(emptyList(), listOf(config.directory.resolve(DEFAULT_DOCUMENT_DIRECTORY).normalize()))

            val documents = listed.values.flatMap(::documentPaths).map { config.directory.resolve(it).normalize() }
            val manifests = documents.map { it.resolveSibling(MANIFEST_FILE_NAME) }

            return DocumentOutputs((documents + manifests).distinct().sorted(), emptyList())
        }

        // An api's documents: one path, one object with `path`, or named documents each a path or such an object.
        private fun documentPaths(apiDocuments: JsonElement): List<String> {
            documentPath(apiDocuments)?.let { return listOf(it) }

            return (apiDocuments as? JsonObject)?.values?.mapNotNull(::documentPath).orEmpty()
        }

        private fun documentPath(document: JsonElement): String? = when (document) {
            is JsonPrimitive -> document.content.takeIf { document.isString }
            is JsonObject -> (document[PATH_KEY] as? JsonPrimitive)?.content
            else -> null
        }
    }
}
