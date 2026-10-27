package io.github.jubasse.seampact.springboot.runtime;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;

/**
 * Reads a path, query or header string as the contract's wire form says (ADR 0016 "Query and bounded values"):
 * a number or a boolean when the declared type is one and the text is one exactly, else the text as sent, which
 * step 6 then refuses with its rule.
 */
final class WireDecoding {
    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;
    private static final String ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    private static final String COMPONENT_SAFE = ALPHANUMERIC + "-_.!~*'()";
    private static final String QUERY_SAFE = ALPHANUMERIC + "-._~!$&'()*+,;=:@/?";

    private WireDecoding() {}

    static JsonNode decode(String text, JsonNode typeUse) {
        String type = typeUse.path("kind").asString().equals("scalar") ? typeUse.path("type").asString() : "";

        return switch (type) {
            case "integer" -> integerOrText(text);
            case "number" -> numberOrText(text);
            case "boolean" -> text.equals("true") || text.equals("false") ? NODES.booleanNode(Boolean.parseBoolean(text)) : NODES.stringNode(text);
            default -> NODES.stringNode(text);
        };
    }

    private static JsonNode integerOrText(String text) {
        if (!text.matches("-?(0|[1-9][0-9]*)")) return NODES.stringNode(text);

        return NODES.numberNode(new BigInteger(text));
    }

    private static JsonNode numberOrText(String text) {
        if (!text.matches("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?")) return NODES.stringNode(text);

        return NODES.numberNode(new BigDecimal(text));
    }

    /** The members of a raw query string, form-decoded (`+` is a space), each name with its values in order. */
    static Map<String, List<String>> queryMembers(String rawQuery) {
        Map<String, List<String>> members = new LinkedHashMap<>();
        if (rawQuery == null || rawQuery.isEmpty()) return members;

        for (String pair : rawQuery.split("&")) {
            if (pair.isEmpty()) continue;
            int equals = pair.indexOf('=');
            String name = formDecoded(equals < 0 ? pair : pair.substring(0, equals));
            String value = equals < 0 ? "" : formDecoded(pair.substring(equals + 1));
            members.computeIfAbsent(name, key -> new ArrayList<>()).add(value);
        }

        return members;
    }

    /** The raw query with the member [name] set to [value], every other pair kept as received, made link-safe. */
    static String withQueryMember(String rawQuery, String name, String value) {
        List<String> pairs = keptQueryPairs(rawQuery, List.of(name));
        pairs.add(componentEncoded(name) + "=" + componentEncoded(value));

        return String.join("&", pairs);
    }

    /** The raw query without the members [names], every other pair kept as received, made link-safe. */
    static String withoutQueryMembers(String rawQuery, List<String> names) {
        return String.join("&", keptQueryPairs(rawQuery, names));
    }

    private static List<String> keptQueryPairs(String rawQuery, List<String> names) {
        List<String> kept = new ArrayList<>();
        if (rawQuery == null) return kept;

        for (String pair : rawQuery.split("&")) {
            if (pair.isEmpty()) continue;
            int equals = pair.indexOf('=');
            if (names.contains(formDecoded(equals < 0 ? pair : pair.substring(0, equals)))) continue;
            kept.add(linkSafe(pair));
        }

        return kept;
    }

    // Characters outside the RFC 3986 query set, and a `%` that starts no escape, are percent-encoded, so a raw `>` or
    // `"` the server accepted cannot break the `Link` target built from the pair.
    private static String linkSafe(String pair) {
        StringBuilder safe = new StringBuilder();
        byte[] bytes = pair.getBytes(StandardCharsets.UTF_8);
        for (int index = 0; index < bytes.length; index++) {
            char character = (char) (bytes[index] & 0xFF);
            boolean escapeStart = character == '%' && index + 2 < bytes.length && isHex(bytes[index + 1]) && isHex(bytes[index + 2]);
            if (escapeStart || (character != '%' && QUERY_SAFE.indexOf(character) >= 0)) safe.append(character);
            else safe.append(String.format("%%%02X", bytes[index] & 0xFF));
        }

        return safe.toString();
    }

    // `encodeURIComponent`: every byte outside the unreserved set and `!*'()` is percent-encoded.
    static String componentEncoded(String text) {
        StringBuilder encoded = new StringBuilder();
        for (byte value : text.getBytes(StandardCharsets.UTF_8)) {
            char character = (char) (value & 0xFF);
            if (COMPONENT_SAFE.indexOf(character) >= 0) encoded.append(character);
            else encoded.append(String.format("%%%02X", value & 0xFF));
        }

        return encoded.toString();
    }

    private static boolean isHex(byte value) {
        return Character.digit((char) value, 16) >= 0;
    }

    private static String formDecoded(String text) {
        return URLDecoder.decode(text, StandardCharsets.UTF_8);
    }
}
