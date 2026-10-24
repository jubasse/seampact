package com.example.tasksservice.api.spring.runtime;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/** The Java value of a validated scalar, as the generated types hold it: a scope id or a subject id for a hook. */
final class ScalarValues {
    private ScalarValues() {}

    static Object of(JsonNode value, JsonNode typeUse) {
        if (!"scalar".equals(typeUse.path("kind").asString())) return value.asString();

        return switch (typeUse.path("type").asString()) {
            case "integer" -> value.longValue();
            case "number" -> value.doubleValue();
            case "boolean" -> value.booleanValue();
            default -> stringValue(value.asString(), typeUse.path("format").asString(""));
        };
    }

    private static Object stringValue(String text, String format) {
        return switch (format) {
            case "uuid" -> UUID.fromString(text);
            case "date-time" -> OffsetDateTime.parse(text);
            case "date" -> LocalDate.parse(text);
            default -> text;
        };
    }
}
