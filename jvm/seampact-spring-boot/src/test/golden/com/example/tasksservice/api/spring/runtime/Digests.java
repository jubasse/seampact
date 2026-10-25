package com.example.tasksservice.api.spring.runtime;

import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CharsetEncoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;

/**
 * The SHA-256 digests of the boundary (the idempotency key, the throttle bucket key, the strong ETag), over the text
 * `JSON.stringify` writes with object members sorted by name, so every target derives the same key from the same
 * values (ADR 0022 "Query and bounded values").
 */
final class Digests {
    private static final byte[] REPLACEMENT_CHARACTER = {(byte) 0xEF, (byte) 0xBF, (byte) 0xBD};
    // `JSON.stringify` writes an exponent from 1e21 up and below 1e-6.
    private static final BigDecimal PLAIN_UPPER = new BigDecimal("1e21");
    private static final BigDecimal PLAIN_LOWER = new BigDecimal("1e-6");

    private Digests() {}

    /** The SHA-256 of the canonical JSON of [parts], as lowercase hex. */
    static String hexOf(List<JsonNode> parts) {
        return HexFormat.of().formatHex(sha256(utf8(canonicalArray(parts))));
    }

    /** The SHA-256 of [bytes], as lowercase hex. */
    static String hexOf(byte[] bytes) {
        return HexFormat.of().formatHex(sha256(bytes));
    }

    /** The SHA-256 of the canonical JSON of [parts], as unpadded base64url. */
    static String base64UrlOf(List<JsonNode> parts) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(sha256(utf8(canonicalArray(parts))));
    }

    /** The SHA-256 of [bytes], as unpadded base64url. */
    static String base64UrlOf(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(sha256(bytes));
    }

    private static String canonicalArray(List<JsonNode> parts) {
        StringBuilder text = new StringBuilder("[");
        for (int index = 0; index < parts.size(); index++) {
            if (index > 0) text.append(',');
            writeValue(parts.get(index), text);
        }

        return text.append(']').toString();
    }

    /** [value] as `JSON.stringify` writes it, object members sorted by name. */
    static String canonical(JsonNode value) {
        StringBuilder text = new StringBuilder();
        writeValue(value, text);

        return text.toString();
    }

    private static void writeValue(JsonNode value, StringBuilder text) {
        if (value == null || value.isMissingNode() || value.isNull()) {
            text.append("null");
        } else if (value.isObject()) {
            writeObject(value, text);
        } else if (value.isArray()) {
            text.append('[');
            for (int index = 0; index < value.size(); index++) {
                if (index > 0) text.append(',');
                writeValue(value.get(index), text);
            }
            text.append(']');
        } else if (value.isNumber()) {
            text.append(jsNumber(value.decimalValue()));
        } else if (value.isBoolean()) {
            text.append(value.asBoolean());
        } else {
            writeString(value.asString(), text);
        }
    }

    // Members sorted by UTF-16 code units, as JavaScript's default sort compares them.
    private static void writeObject(JsonNode value, StringBuilder text) {
        List<Map.Entry<String, JsonNode>> members = new ArrayList<>(value.properties());
        members.sort(Map.Entry.comparingByKey());

        text.append('{');
        for (int index = 0; index < members.size(); index++) {
            if (index > 0) text.append(',');
            writeString(members.get(index).getKey(), text);
            text.append(':');
            writeValue(members.get(index).getValue(), text);
        }
        text.append('}');
    }

    private static void writeString(String value, StringBuilder text) {
        text.append('"');
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> text.append("\\\"");
                case '\\' -> text.append("\\\\");
                case '\b' -> text.append("\\b");
                case '\f' -> text.append("\\f");
                case '\n' -> text.append("\\n");
                case '\r' -> text.append("\\r");
                case '\t' -> text.append("\\t");
                default -> appendCharacter(value, index, character, text);
            }
        }
        text.append('"');
    }

    // A control character and a lone surrogate are written as a lowercase `\\u` escape, as `JSON.stringify` does.
    private static void appendCharacter(String value, int index, char character, StringBuilder text) {
        boolean loneHigh = Character.isHighSurrogate(character) && (index + 1 >= value.length() || !Character.isLowSurrogate(value.charAt(index + 1)));
        boolean loneLow = Character.isLowSurrogate(character) && (index == 0 || !Character.isHighSurrogate(value.charAt(index - 1)));
        if (character < 0x20 || loneHigh || loneLow) {
            text.append(String.format("\\u%04x", (int) character));
            return;
        }

        text.append(character);
    }

    // A number as JavaScript prints its double: integral values without a fraction, an exponent outside 1e-6..1e21.
    static String jsNumber(BigDecimal value) {
        double asDouble = value.doubleValue();
        if (asDouble == 0) return "0";

        BigDecimal shortest = new BigDecimal(Double.toString(asDouble)).stripTrailingZeros();
        BigDecimal magnitude = shortest.abs();
        if (magnitude.compareTo(PLAIN_LOWER) >= 0 && magnitude.compareTo(PLAIN_UPPER) < 0) return shortest.toPlainString();

        String digits = shortest.unscaledValue().abs().toString();
        int exponent = digits.length() - 1 - shortest.scale();
        String mantissa = digits.length() == 1 ? digits : digits.charAt(0) + "." + digits.substring(1);
        String sign = shortest.signum() < 0 ? "-" : "";

        return sign + mantissa + "e" + (exponent < 0 ? "-" : "+") + Math.abs(exponent);
    }

    // `TextEncoder` writes a lone surrogate as U+FFFD; the JDK's default writes `?`.
    private static byte[] utf8(String text) {
        CharsetEncoder encoder = StandardCharsets.UTF_8.newEncoder()
                .onMalformedInput(CodingErrorAction.REPLACE)
                .onUnmappableCharacter(CodingErrorAction.REPLACE)
                .replaceWith(REPLACEMENT_CHARACTER);
        try {
            ByteBuffer encoded = encoder.encode(CharBuffer.wrap(text));
            byte[] bytes = new byte[encoded.remaining()];
            encoded.get(bytes);
            return bytes;
        } catch (CharacterCodingException impossible) {
            throw new IllegalStateException("seampact: encoding a digest's text failed", impossible);
        }
    }

    private static byte[] sha256(byte[] bytes) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(bytes);
        } catch (NoSuchAlgorithmException missing) {
            throw new IllegalStateException("seampact: the JDK has no SHA-256", missing);
        }
    }
}
