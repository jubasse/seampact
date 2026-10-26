package com.example.tasks.api.spring.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** The success body in its format's envelope (ADR 0002 section 13), as the Node and PHP targets write it. */
class SuccessEnvelopeTest {
    private static final JsonMapper MAPPER = BoundaryMapper.create();

    private static final String ENVELOPED_FORMAT = """
            {"absent": "omit", "success": {"item": {"headers": [], "body": {"kind": "object", "members": [
              {"name": {"kind": "text", "text": "data"}, "value": {"kind": "slot", "slot": "payload", "path": []}},
              {"name": {"kind": "text", "text": "status"}, "value": {"kind": "slot", "slot": "status", "path": []}},
              {"name": {"kind": "text", "text": "path"}, "value": {"kind": "slot", "slot": "path", "path": []}}]}}}}
            """;

    private static final String BARE_FORMAT = """
            {"absent": "omit", "success": {"item": {"headers": [], "body": {"kind": "slot", "slot": "payload", "path": []}}}}
            """;

    private static JsonNode bodyOf(String format, String payload) {
        return SuccessEnvelope.body(MAPPER.readTree(format), "item", MAPPER.readTree(payload), 200, "/v1/tasks/t");
    }

    @Test
    void anEnvelopedFormatWrapsThePayloadWithItsStatusAndPath() {
        assertEquals(MAPPER.readTree("{\"data\": {\"id\": \"t\"}, \"status\": 200, \"path\": \"/v1/tasks/t\"}"), bodyOf(ENVELOPED_FORMAT, "{\"id\": \"t\"}"));
    }

    @Test
    void aBareFormatWritesThePayloadItself() {
        assertEquals(MAPPER.readTree("[1, 2]"), bodyOf(BARE_FORMAT, "[1, 2]"));
    }

    @Test
    void anEnvelopedFormatWritesANullPayloadUnderItsMember() {
        assertEquals(MAPPER.readTree("{\"data\": null, \"status\": 200, \"path\": \"/v1/tasks/t\"}"), bodyOf(ENVELOPED_FORMAT, "null"));
    }
}
