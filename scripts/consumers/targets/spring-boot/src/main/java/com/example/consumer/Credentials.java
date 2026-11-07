package com.example.consumer;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** The credentials the doubles honour, read from the shared `credentials.json` the suite CLI reads too. */
final class Credentials {
    private static final JsonNode VALUES = load();

    private Credentials() {}

    static String text(String name) {
        JsonNode value = VALUES.path(name);
        if (value.isMissingNode()) throw new IllegalStateException("credentials.json has no '" + name + "'");

        return value.asString();
    }

    static long number(String name) {
        return VALUES.path(name).asLong();
    }

    private static JsonNode load() {
        try (InputStream input = Credentials.class.getResourceAsStream("/credentials.json")) {
            if (input == null) throw new IllegalStateException("credentials.json is missing from the classpath; assemble.sh copies it");
            return JsonMapper.builder().build().readTree(input);
        } catch (IOException failure) {
            throw new UncheckedIOException("reading credentials.json failed", failure);
        }
    }
}
