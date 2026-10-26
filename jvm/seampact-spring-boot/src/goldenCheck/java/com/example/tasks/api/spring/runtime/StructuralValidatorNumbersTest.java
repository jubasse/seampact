package com.example.tasks.api.spring.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The numbers the structural pass refuses: a non-finite number, in a number or anywhere in an opaque value, a decimal
 * that is no string, an integer past the safe range.
 */
class StructuralValidatorNumbersTest {
    private static final JsonMapper MAPPER = BoundaryMapper.create();
    private final StructuralValidator validator = new StructuralValidator(new ContractTable(MAPPER.readTree("{\"operations\": []}")));

    private static JsonNode scalar(String type, String format) {
        String formatMember = format.isEmpty() ? "" : ", \"format\": \"" + format + "\"";

        return MAPPER.readTree("{\"kind\": \"scalar\", \"type\": \"" + type + "\"" + formatMember + "}");
    }

    private List<InputIssue> issuesOf(String json, JsonNode typeUse) {
        return validator.issuesOf(MAPPER.readTree(json), typeUse, "body", "/x");
    }

    private static List<InputIssue> issue(String rule) {
        return List.of(new InputIssue("body", "/x", rule));
    }

    @Test
    void nonFiniteNumberIsATypeIssue() {
        JsonNode number = scalar("number", "");

        assertEquals(issue("type"), issuesOf("1e400", number));
        assertEquals(issue("type"), issuesOf("-1e400", number));
        assertEquals(List.of(), issuesOf("1e300", number));
    }

    @Test
    void nonFiniteNumberAnywhereInAnOpaqueValueIsATypeIssue() {
        JsonNode opaque = MAPPER.readTree("{\"kind\": \"opaque\"}");

        assertEquals(issue("type"), issuesOf("1e400", opaque));
        assertEquals(issue("type"), issuesOf("{\"a\": [1, {\"b\": -1e400}]}", opaque));
        assertEquals(List.of(), issuesOf("{\"a\": [1e300, null, \"x\"]}", opaque));
        assertEquals(List.of(), issuesOf("null", opaque));
    }

    @Test
    void decimalMemberRefusesANumberAndAnExponentText() {
        JsonNode decimal = scalar("string", "decimal");

        assertEquals(issue("type"), issuesOf("1e400", decimal));
        assertEquals(issue("format"), issuesOf("\"1e400\"", decimal));
        assertEquals(List.of(), issuesOf("\"" + "9".repeat(400) + "\"", decimal));
    }

    @Test
    void integerPastTheSafeRangeIsAMinimumOrMaximumIssue() {
        JsonNode integer = scalar("integer", "");

        assertEquals(List.of(), issuesOf("9007199254740991", integer));
        assertEquals(List.of(), issuesOf("-9007199254740991", integer));
        assertEquals(issue("maximum"), issuesOf("9007199254740992", integer));
        assertEquals(issue("minimum"), issuesOf("-9007199254740992", integer));
        assertEquals(issue("maximum"), issuesOf("99999999999999999999", integer));
    }
}
