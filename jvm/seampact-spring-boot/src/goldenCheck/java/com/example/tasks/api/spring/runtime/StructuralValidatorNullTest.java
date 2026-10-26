package com.example.tasks.api.spring.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** An opaque value takes `null` only when its use or its property is nullable (ADR 0003 section 2). */
class StructuralValidatorNullTest {
    private static final JsonMapper MAPPER = BoundaryMapper.create();
    private static final String OPAQUE = "{\"kind\": \"opaque\", \"reason\": \"any webhook payload\"}";
    private static final String NULLABLE_OPAQUE = "{\"kind\": \"opaque\", \"reason\": \"any webhook payload\", \"nullable\": true}";
    private static final String EVENT_SCHEMA = """
            {"operations": [], "schemas": {"Event": {"kind": "object", "properties": [
              {"name": "data", "type": %s, "optional": false, "nullable": false},
              {"name": "extra", "type": %s, "optional": true, "nullable": true}]}}}
            """.formatted(OPAQUE, OPAQUE);

    private final StructuralValidator validator = new StructuralValidator(new ContractTable(MAPPER.readTree(EVENT_SCHEMA)));

    private List<InputIssue> issuesOf(String json, String typeUse) {
        return validator.issuesOf(MAPPER.readTree(json), MAPPER.readTree(typeUse), "body", "");
    }

    @Test
    void aNullOpaqueValueIsATypeIssueUnlessNullable() {
        assertEquals(List.of(new InputIssue("body", "", "type")), issuesOf("null", OPAQUE));
        assertEquals(List.of(), issuesOf("null", NULLABLE_OPAQUE));
        assertEquals(List.of(), issuesOf("[null, {\"a\": null}]", OPAQUE));
    }

    @Test
    void aNullOpaquePropertyIsATypeIssueUnlessThePropertyIsNullable() {
        String event = "{\"kind\": \"ref\", \"schema\": \"Event\"}";

        assertEquals(List.of(new InputIssue("body", "/data", "type")), issuesOf("{\"data\": null}", event));
        assertEquals(List.of(), issuesOf("{\"data\": 1, \"extra\": null}", event));
    }

    @Test
    void aNullOpaqueItemIsATypeIssueUnlessTheItemsAreNullable() {
        assertEquals(List.of(new InputIssue("body", "/1", "type")), issuesOf("[1, null]", "{\"kind\": \"array\", \"items\": " + OPAQUE + "}"));
        assertEquals(List.of(), issuesOf("[1, null]", "{\"kind\": \"array\", \"items\": " + NULLABLE_OPAQUE + "}"));
    }
}
