package com.example.tasksservice.api.spring.runtime;

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

    private static String formDecoded(String text) {
        return URLDecoder.decode(text, StandardCharsets.UTF_8);
    }
}
