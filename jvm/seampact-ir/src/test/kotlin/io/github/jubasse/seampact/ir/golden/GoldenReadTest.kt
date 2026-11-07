package io.github.jubasse.seampact.ir.golden

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.IrJson
import io.github.jubasse.seampact.ir.model.SourceMap
import io.github.jubasse.seampact.ir.read.IrReader
import io.github.jubasse.seampact.ir.read.IrSupport
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.name
import kotlin.io.path.readText
import kotlin.streams.toList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonElement

// The model reads every golden IR and side table and writes it back equal up to member order. The files are
// found by walking `fixtures/golden`, so a case another lane adds is read without a change here.
class GoldenReadTest {
    private val golden: Path =
        Path.of(System.getProperty("seampact.repositoryRoot"), "fixtures/golden")

    private val support = IrSupport.ofModel(kinds = listOf("httpOperation"))

    private fun goldenFilesEnding(suffix: String): List<Path> =
        Files.walk(golden).use { paths ->
            paths.filter { it.name.endsWith(suffix) }.sorted().toList()
        }

    private fun parse(file: Path): JsonElement = IrJson.parseToJsonElement(file.readText())

    @Test
    fun findsGoldenFiles() {
        assertTrue(goldenFilesEnding(".ir.json").isNotEmpty())
        assertTrue(goldenFilesEnding(".source-map.json").isNotEmpty())
    }

    @Test
    fun goldenIrsReadAndWriteBackEqual() {
        for (file in goldenFilesEnding(".ir.json")) {
            val contract = IrReader.read(file.readText(), support)

            assertEquals(parse(file), IrJson.encodeToJsonElement(ContractIR.serializer(), contract), file.toString())
        }
    }

    @Test
    fun goldenSideTablesReadAndWriteBackEqual() {
        for (file in goldenFilesEnding(".source-map.json")) {
            val sourceMap = IrJson.decodeFromJsonElement(SourceMap.serializer(), parse(file))

            assertEquals(parse(file), IrJson.encodeToJsonElement(SourceMap.serializer(), sourceMap), file.toString())
        }
    }
}
