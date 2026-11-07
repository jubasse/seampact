package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.config.AppConfig
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals

// Where the binary writes an app's OpenAPI documents, for the build to declare them as outputs (ADR 0011).
class DocumentOutputsTest {
    private val directory: Path = Path.of("/app")

    private fun configWith(openapi: String?): AppConfig = AppConfig(
        "test", directory, directory.resolve("out"), null, emptyMap(), emptyList(), emptyList(),
        openapi?.let { Json.parseToJsonElement(it) as JsonElement }, null, null, null,
    )

    @Test
    fun withoutOpenapiTheDocumentsGoToTheOpenapiDirectoryBesideTheConfig() {
        assertEquals(DocumentOutputs(emptyList(), listOf(directory.resolve("openapi"))), DocumentOutputs.of(configWith(null)))
    }

    @Test
    fun aDocumentIsItsFileAndTheManifestOfItsDirectory() {
        val outputs = DocumentOutputs.of(configWith("""{"tasks": "docs/tasks.json"}"""))

        assertEquals(
            DocumentOutputs(listOf(directory.resolve("docs/.seampact-manifest.json"), directory.resolve("docs/tasks.json")), emptyList()),
            outputs,
        )
    }

    @Test
    fun anObjectWithAPathAndNamedDocumentsEachCountOnce() {
        val outputs = DocumentOutputs.of(
            configWith("""{"tasks": {"path": "docs/tasks.json"}, "billing": {"public": "docs/public.json", "internal": {"path": "docs/internal.json"}}}"""),
        )

        assertEquals(
            listOf(
                directory.resolve("docs/.seampact-manifest.json"),
                directory.resolve("docs/internal.json"),
                directory.resolve("docs/public.json"),
                directory.resolve("docs/tasks.json"),
            ),
            outputs.files,
        )
        assertEquals(emptyList(), outputs.directories)
    }

    @Test
    fun aNamedDocumentThatIsNotAPathContributesNoFile() {
        assertEquals(DocumentOutputs(emptyList(), emptyList()), DocumentOutputs.of(configWith("""{"tasks": {"public": 3}}""")))
    }
}
