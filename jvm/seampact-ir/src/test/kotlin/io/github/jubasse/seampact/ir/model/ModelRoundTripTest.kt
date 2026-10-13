package io.github.jubasse.seampact.ir.model

import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

// The generated model reads the IR examples and writes back the same document, up to member order and the
// unknown members it drops. The reader with its version and support checks comes on top of this model.
class ModelRoundTripTest {
    private val examples: Path =
        Path.of(System.getProperty("seampact.repositoryRoot"), "packages/spec/schemas/ir/examples")

    private fun example(name: String): JsonElement = IrJson.parseToJsonElement(examples.resolve(name).readText())

    private fun roundTrip(document: JsonElement): JsonElement {
        val contract = IrJson.decodeFromJsonElement(ContractIR.serializer(), document)
        return IrJson.encodeToJsonElement(ContractIR.serializer(), contract)
    }

    @Test
    fun examplesWithoutUnknownMembersRoundTrip() {
        for (name in listOf("minimal.ir.json", "every-member.ir.json", "unknown-enum-value.ir.json")) {
            val document = example(name)
            assertEquals(document, roundTrip(document), name)
        }
    }

    @Test
    fun unknownMembersAreDropped() {
        val document = example("unknown-member.ir.json").jsonObject
        val api = document.getValue("api").jsonObject
        val origin = api.getValue("origin").jsonObject
        val expected = JsonObject(
            document - "generatedBy" + ("api" to JsonObject(api - "owner" + ("origin" to JsonObject(origin - "column")))),
        )

        assertEquals(expected, roundTrip(document))
    }

    @Test
    fun unknownEnumValueIsKept() {
        val contract = IrJson.decodeFromJsonElement(ContractIR.serializer(), example("unknown-enum-value.ir.json"))

        assertIs<Maturity.Unknown>(contract.api.maturity)
    }

    @Test
    fun emptyObjectsRoundTrip() {
        val document = example("minimal.ir.json").jsonObject
        val api = document.getValue("api").jsonObject
        val written = roundTrip(document).jsonObject

        assertEquals(JsonObject(emptyMap()), written.getValue("api").jsonObject.getValue("extensions"))
        assertEquals(JsonObject(emptyMap()), written.getValue("api").jsonObject.getValue("docs"))
        assertEquals(JsonObject(emptyMap()), written.getValue("schemas"))
        assertEquals(api.getValue("extensions"), written.getValue("api").jsonObject.getValue("extensions"))
    }

    @Test
    fun optionalOpaqueKeepsAnExplicitNull() {
        val withNull = """{"code": "conflict", "example": null}"""
        val absent = """{"code": "conflict"}"""

        val decodedNull = IrJson.decodeFromString(OperationError.serializer(), withNull)
        val decodedAbsent = IrJson.decodeFromString(OperationError.serializer(), absent)

        assertEquals(JsonNull, decodedNull.example)
        assertEquals(null, decodedAbsent.example)
        assertEquals(IrJson.parseToJsonElement(withNull), IrJson.encodeToJsonElement(OperationError.serializer(), decodedNull))
        assertEquals(IrJson.parseToJsonElement(absent), IrJson.encodeToJsonElement(OperationError.serializer(), decodedAbsent))
    }

    @Test
    fun reservedTypeNameIsEscaped() {
        assertEquals("Enum_", Enum_::class.simpleName)
    }

    @Test
    fun unknownUnionTagIsKeptRaw() {
        val document = example("unknown-kind.ir.json")
        val contract = IrJson.decodeFromJsonElement(ContractIR.serializer(), document)
        val point = assertIs<Schema.Unknown>(contract.schemas.getValue("Point"))

        assertEquals("tuple", point.kind)
        assertEquals(document.jsonObject.getValue("schemas").jsonObject.getValue("Point"), point.raw)
        assertEquals(document, roundTrip(document))
    }

    @Test
    fun missingTagNamesTheUnion() {
        val error = assertFailsWith<SerializationException> {
            IrJson.decodeFromString(TypeUse.serializer(), """{"schema": "Task"}""")
        }

        assertTrue(error.message.orEmpty().startsWith("TypeUse: the tag member 'kind'"), error.message)
    }

    @Test
    fun sourceMapRoundTrips() {
        val document = example("minimal.source-map.json")
        val sourceMap = IrJson.decodeFromJsonElement(SourceMap.serializer(), document)

        assertEquals(document, IrJson.encodeToJsonElement(SourceMap.serializer(), sourceMap))
    }

    @Test
    fun variantTagIsFixed() {
        assertFailsWith<IllegalArgumentException> {
            IrJson.decodeFromString(BodyUnionTag.serializer(), """{"in": "header", "property": "kind"}""")
        }
        assertFailsWith<IllegalArgumentException> { BodyUnionTag(in_ = "header", property = "kind") }
    }

    @Test
    fun unknownCasesStayUnknown() {
        val raw = JsonObject(mapOf("kind" to JsonPrimitive("tuple")))

        assertFailsWith<IllegalArgumentException> { Schema.Unknown("object", JsonObject(mapOf("kind" to JsonPrimitive("object")))) }
        assertFailsWith<IllegalArgumentException> { Schema.Unknown("pair", raw) }
        assertFailsWith<IllegalArgumentException> { Maturity.Unknown("stable") }
        assertEquals(Maturity.STABLE, Maturity.of("stable"))
    }

    @Test
    fun integralNumberReadsAsInteger() {
        val withFraction = IrJson.decodeFromString(ErrorHttp.serializer(), """{"status": 404.0}""")

        assertEquals(404L, withFraction.status)
        assertFailsWith<SerializationException> { IrJson.decodeFromString(ErrorHttp.serializer(), """{"status": 404.5}""") }
        assertFailsWith<SerializationException> { IrJson.decodeFromString(ErrorHttp.serializer(), """{"status": "404"}""") }
    }
}
