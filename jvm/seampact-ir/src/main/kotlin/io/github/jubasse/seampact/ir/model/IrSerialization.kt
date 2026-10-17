// Generated from scripts/ir-models/kotlin.ts by scripts/ir-models for IR revision 3. Do not edit.
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
    public const val IR_REVISION: Long = 3
}

/** The JSON configuration of the IR model: unknown members are tolerated and dropped (ADR 0005 section 3). */
public val IrJson: Json = Json { ignoreUnknownKeys = true }

/** The longest number literal the IR reads: no IR integer, version or revision is written longer. */
internal const val IR_NUMBER_LITERAL_MAX_LENGTH = 64

/** The largest IR integer, 2^53 - 1: IR integers are in the safe range of I-JSON (RFC 7493). */
internal const val IR_INTEGER_MAX: Long = 9007199254740991L

/**
 * An IR integer as a `Long`, from -(2^53 - 1) to 2^53 - 1. An integral number written with a fraction
 * (`2.0`), which JSON Schema counts as an integer, reads as that integer; any other value is an error naming
 * it: a literal as written, a longer literal by its length, a string, array or object by its JSON type, never
 * its content.
 */
internal object IrIntegerSerializer : KSerializer<Long> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("io.github.jubasse.seampact.ir.model.IrInteger", PrimitiveKind.LONG)

    override fun deserialize(decoder: Decoder): Long {
        val element = jsonDecoder(decoder, "an integer").decodeJsonElement()
        val literal = (element as? JsonPrimitive)?.takeIf { !it.isString }?.content
            ?: throw SerializationException("expected an integer, got the JSON type ${notALiteral(element)}")
        if (literal.length > IR_NUMBER_LITERAL_MAX_LENGTH) {
            throw SerializationException("expected an integer, got a literal of ${literal.length} chars")
        }

        val number = literal.toBigDecimalOrNull() ?: throw SerializationException("expected an integer, got $literal")
        val integer = try {
            number.longValueExact()
        } catch (error: ArithmeticException) {
            throw SerializationException("expected an integer from -(2^53 - 1) to 2^53 - 1, got $literal", error)
        }
        if (integer < -IR_INTEGER_MAX || integer > IR_INTEGER_MAX) {
            throw SerializationException("expected an integer from -(2^53 - 1) to 2^53 - 1, got $literal")
        }

        return integer
    }

    override fun serialize(encoder: Encoder, value: Long) {
        encoder.encodeLong(value)
    }

    private fun notALiteral(element: JsonElement): String = when (element) {
        is JsonObject -> "object"
        is JsonPrimitive -> "string"
        else -> "array"
    }
}

/** An optional opaque member: absent is `null`, a JSON `null` is [JsonNull]. */
internal object IrOptionalOpaqueSerializer : KSerializer<JsonElement?> {
    override val descriptor: SerialDescriptor = JsonElement.serializer().descriptor.nullable

    override fun deserialize(decoder: Decoder): JsonElement? =
        jsonDecoder(decoder, "an opaque value").decodeJsonElement()

    override fun serialize(encoder: Encoder, value: JsonElement?) {
        jsonEncoder(encoder, "an opaque value").encodeJsonElement(value ?: JsonNull)
    }
}

/** A tagged union: the tag member picks the variant; an unknown tag is kept as the union's `Unknown` variant. */
internal abstract class IrUnionSerializer<T : Any>(
    private val union: String,
    private val tagMember: String,
) : KSerializer<T> {
    override val descriptor: SerialDescriptor =
        SerialDescriptor("io.github.jubasse.seampact.ir.model.$union", JsonObject.serializer().descriptor)

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
internal abstract class IrOpenEnumSerializer<T : Any>(
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

/**
 * The shape of the IR the reader walks on the raw JSON to find an unknown tag or value of a must-act definition
 * (ADR 0005 section 3): a definition by name, a struct's walked members, a tagged union, an open enum, an array
 * or a map. A member that holds no definition is not listed.
 */
internal sealed interface IrShape {
    class Named(val definition: String) : IrShape

    class Struct(val members: Map<String, IrShape>) : IrShape

    class Union(val tag: String, val mustAct: Boolean, val variants: Map<String, String>) : IrShape

    class OpenEnum(val known: Set<String>, val mustAct: Boolean) : IrShape

    class Items(val of: IrShape) : IrShape

    class Values(val of: IrShape) : IrShape
}

private fun jsonDecoder(decoder: Decoder, what: String): JsonDecoder =
    decoder as? JsonDecoder ?: throw SerializationException("$what is read from JSON only, through IrJson")

private fun jsonEncoder(encoder: Encoder, what: String): JsonEncoder =
    encoder as? JsonEncoder ?: throw SerializationException("$what is written to JSON only, through IrJson")
