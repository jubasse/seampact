package io.github.jubasse.seampact.ir.naming

import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private const val NO_SEGMENT = "no-segment"

private val SOURCES = mapOf("name" to NameSource.NAME, "enumValue" to NameSource.ENUM_VALUE, "right" to NameSource.RIGHT)

// The shared naming vectors (ADR 0007 section 6) against the native implementation: the `kotlin` and `java` columns.
class NamingVectorsTest {
    private val vectors: List<JsonObject> = Json
        .parseToJsonElement(
            Path.of(System.getProperty("seampact.repositoryRoot"), "packages/core/spec/vectors/naming/vectors.json").readText(),
        )
        .jsonArray
        .map { it.jsonObject }

    private fun JsonObject.text(member: String): String? = this[member]?.jsonPrimitive?.content

    private fun JsonObject.segmentList(member: String): List<String>? =
        (this[member] as? JsonArray)?.map { it.jsonPrimitive.content }

    private fun segmentsOfVector(vector: JsonObject): List<String>? {
        vector.segmentList("owner")?.let { return it }

        return segmentsOf(
            written = checkNotNull(vector.text("written")),
            source = checkNotNull(SOURCES[vector.text("source")]),
            codeName = vector.text("codeName"),
            position = vector["position"]?.jsonPrimitive?.int,
        )
    }

    @Test
    fun vectorsPass() {
        assertTrue(vectors.size > 100)

        for (vector in vectors) {
            val id = checkNotNull(vector.text("id"))
            val segments = segmentsOfVector(vector)

            if (vector.text("error") != null) {
                assertEquals(NO_SEGMENT, vector.text("error"), id)
                assertNull(segments, id)
                continue
            }

            assertEquals(vector.segmentList("segments"), segments, id)
            checkIdentifiers(id, vector, checkNotNull(segments))
            checkOperationIds(id, vector, segments)
        }
    }

    private fun checkIdentifiers(id: String, vector: JsonObject, segments: List<String>) {
        val role = checkNotNull(NamingRole.ofWire(checkNotNull(vector.text("role"))))
        val name = IrName(segments, role, vector["status"]?.jsonPrimitive?.int)
        val expected = vector.getValue("expected").jsonObject

        for (language in NamingLanguage.entries) {
            val want = (expected.getValue(language.wire) as JsonPrimitive).content

            assertEquals(want, identifier(name, language), "$id ${language.wire}")
        }
    }

    private fun checkOperationIds(id: String, vector: JsonObject, segments: List<String>) {
        val want = vector["operationId"]?.jsonObject ?: return

        assertEquals(want.text("camel"), operationId(segments, OperationIdCase.CAMEL), "$id camel")
        assertEquals(want.text("snake"), operationId(segments, OperationIdCase.SNAKE), "$id snake")
    }

    @Test
    fun theVectorsCoverTheRolesAndTheSources() {
        assertEquals(NamingRole.entries.map { it.wire }.toSet(), vectors.mapNotNull { it.text("role") }.toSet())
        assertEquals(SOURCES.keys, vectors.mapNotNull { it.text("source") }.toSet())
        assertNotNull(vectors.firstOrNull { it.text("id") == "reserved/schema-list" })
    }

    @Test
    fun anEnumValueNeedsItsPosition() {
        assertFailsWith<IllegalArgumentException> { segmentsOf("done", NameSource.ENUM_VALUE) }
        assertFailsWith<IllegalArgumentException> { segmentsOf("done", NameSource.ENUM_VALUE, position = 0) }
    }

    @Test
    fun aMalformedNameIsRefused() {
        assertFailsWith<IllegalArgumentException> { IrName(listOf("Upper"), NamingRole.SCHEMA) }
        assertFailsWith<IllegalArgumentException> { IrName(listOf("tasks"), NamingRole.RESPONSE) }
        assertFailsWith<IllegalArgumentException> { IrName(listOf("tasks"), NamingRole.RESPONSE, 404) }
        assertFailsWith<IllegalArgumentException> { IrName(listOf("tasks"), NamingRole.INPUT, 200) }
        assertFailsWith<IllegalArgumentException> { identifier(IrName(emptyList(), NamingRole.SCHEMA), NamingLanguage.KOTLIN) }
        assertFailsWith<IllegalArgumentException> { operationId(emptyList()) }
    }
}
