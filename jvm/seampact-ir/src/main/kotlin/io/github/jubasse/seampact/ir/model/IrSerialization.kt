// Generated from scripts/ir-models/kotlin.ts by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write
@file:OptIn(ExperimentalSerializationApi::class)

package io.github.jubasse.seampact.ir.model

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.nullable
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** The IR versions this model was generated for (ADR 0005 section 2). */
public object IrModelVersion {
    public const val IR_VERSION: Long = 1
    public const val IR_REVISION: Long = 2
}

/** The JSON configuration of the IR model: unknown members are tolerated and dropped (ADR 0005 section 3). */
public val IrJson: Json = Json { ignoreUnknownKeys = true }

/** An optional opaque member: absent is `null`, a JSON `null` is [JsonNull]. */
public object IrOptionalOpaqueSerializer : KSerializer<JsonElement?> {
    override val descriptor: SerialDescriptor = JsonElement.serializer().descriptor.nullable

    override fun deserialize(decoder: Decoder): JsonElement? = jsonDecoder(decoder, "an opaque value").decodeJsonElement()

    override fun serialize(encoder: Encoder, value: JsonElement?) {
        jsonEncoder(encoder, "an opaque value").encodeJsonElement(value ?: JsonNull)
    }
}

/** A tagged union: the tag member picks the variant; an unknown tag is kept as the union's `Unknown` variant. */
public abstract class IrUnionSerializer<T : Any>(
    private val union: String,
    private val tagMember: String,
) : KSerializer<T> {
    override val descriptor: SerialDescriptor = JsonObject.serializer().descriptor

    protected abstract fun decodeKnown(json: Json, tag: String, element: JsonObject): T?

    protected abstract fun unknown(tag: String, element: JsonObject): T

    protected abstract fun encode(json: Json, value: T): JsonElement

    override fun deserialize(decoder: Decoder): T {
        val jsonDecoder = jsonDecoder(decoder, union)
        val element = jsonDecoder.decodeJsonElement() as? JsonObject
            ?: throw SerializationException("$union: expected a JSON object")
        val tag = (element[tagMember] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: throw SerializationException("$union: the tag member '$tagMember' is missing or not a string")
        return decodeKnown(jsonDecoder.json, tag, element) ?: unknown(tag, element)
    }

    override fun serialize(encoder: Encoder, value: T) {
        val jsonEncoder = jsonEncoder(encoder, union)
        jsonEncoder.encodeJsonElement(encode(jsonEncoder.json, value))
    }
}

/** An open enum: a known value maps to its constant, any other string to the enum's `Unknown`. */
public abstract class IrOpenEnumSerializer<T : Any>(
    enumName: String,
    private val of: (String) -> T,
    private val valueOf: (T) -> String,
) : KSerializer<T> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("io.github.jubasse.seampact.ir.model.$enumName", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): T = of(decoder.decodeString())

    override fun serialize(encoder: Encoder, value: T) {
        encoder.encodeString(valueOf(value))
    }
}

private fun jsonDecoder(decoder: Decoder, what: String): JsonDecoder =
    decoder as? JsonDecoder ?: throw SerializationException("$what is read from JSON only, through IrJson")

private fun jsonEncoder(encoder: Encoder, what: String): JsonEncoder =
    encoder as? JsonEncoder ?: throw SerializationException("$what is written to JSON only, through IrJson")
