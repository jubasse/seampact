// Generated from scripts/ir-models/kotlin.ts by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write
@file:OptIn(ExperimentalSerializationApi::class)

package io.github.jubasse.seampact.ir.model

import kotlin.math.abs
import kotlin.math.floor
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

/** The largest IR integer, 2^53 - 1: IR integers are in the safe range of I-JSON (RFC 7493). */
internal const val IR_INTEGER_MAX: Long = 9007199254740991L

/** The longest number literal a message shows; a longer one is cut, as other untrusted text is. */
internal const val IR_SHOWN_LITERAL_MAX_LENGTH = 64

// The JSON number grammar (RFC 8259 section 6): the text JavaScript and PHP read as a number, and nothing more
// (no `3d`, `0x1.8p1`, `+3`, `03` or `3.`, which the JVM's own number syntax accepts).
private val JSON_NUMBER = Regex("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?")

/** A JSON number literal as the correctly rounded double, as JavaScript and PHP read it; null for any other text. */
internal fun irNumberOf(literal: String): Double? = if (JSON_NUMBER.matches(literal)) literal.toDouble() else null

/** A number literal cut for a message to [IR_SHOWN_LITERAL_MAX_LENGTH] characters. */
internal fun shownLiteral(literal: String): String =
    if (literal.length <= IR_SHOWN_LITERAL_MAX_LENGTH) literal else literal.take(IR_SHOWN_LITERAL_MAX_LENGTH) + "..."

/**
 * An IR integer as a `Long`, from -(2^53 - 1) to 2^53 - 1. A number literal is read as the correctly
 * rounded double, as JavaScript and PHP read it, so the three readers accept the same literals: `2.0` and
 * `3.0000000000000000001` read as 2 and 3. Any other value is an error naming it: a literal as written (cut
 * to [IR_SHOWN_LITERAL_MAX_LENGTH]), a string, array or object by its JSON type, never its content.
 */
internal object IrIntegerSerializer : KSerializer<Long> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("io.github.jubasse.seampact.ir.model.IrInteger", PrimitiveKind.LONG)

    override fun deserialize(decoder: Decoder): Long {
        val element = jsonDecoder(decoder, "an integer").decodeJsonElement()
        val literal = (element as? JsonPrimitive)?.takeIf { !it.isString }?.content
            ?: throw SerializationException("expected an integer, got the JSON type ${notALiteral(element)}")
        val shown = shownLiteral(literal)
        val number = irNumberOf(literal) ?: throw SerializationException("expected an integer, got $shown")
        if (!number.isFinite() || number != floor(number)) {
            throw SerializationException("expected an integer, got $shown")
        }
        if (abs(number) > IR_INTEGER_MAX.toDouble()) {
            throw SerializationException("expected an integer from -(2^53 - 1) to 2^53 - 1, got $shown")
        }

        return number.toLong()
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
