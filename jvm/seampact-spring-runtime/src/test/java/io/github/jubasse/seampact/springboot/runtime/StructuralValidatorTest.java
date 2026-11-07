package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.MissingNode;

/** Step 6's structural pass: every issue with its pointer and the contract rule, and no coercion. */
class StructuralValidatorTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private static final String TABLE = """
            {"api": {"id": "tasks"},
             "enums": {"Status": {"values": ["open", "done"]}},
             "schemas": {
               "Task": {"kind": "object", "unknownKeys": {"policy": "reject"}, "properties": [
                 {"name": "id", "type": {"kind": "scalar", "type": "string", "refinements": {}}},
                 {"name": "note", "optional": true, "nullable": true, "type": {"kind": "scalar", "type": "string", "refinements": {}}},
                 {"name": "a/b~c", "optional": true, "type": {"kind": "scalar", "type": "boolean", "refinements": {}}}]},
               "Stripped": {"kind": "object", "unknownKeys": {"policy": "strip"}, "properties": [
                 {"name": "id", "type": {"kind": "scalar", "type": "string", "refinements": {}}}]},
               "Kept": {"kind": "object", "unknownKeys": {"policy": "keep"}, "properties": [
                 {"name": "id", "type": {"kind": "scalar", "type": "string", "refinements": {}}}]},
               "Union": {"kind": "union"}}}
            """;

    private final StructuralValidator validator = new StructuralValidator(new ContractTable(MAPPER.readTree(TABLE)));

    private List<String> issues(String json, String typeUse) {
        return validator.issuesOf(MAPPER.readTree(json), MAPPER.readTree(typeUse), "body", "").stream()
                .map(issue -> issue.pointer() + " " + issue.rule()).toList();
    }

    private static String scalar(String type, String refinements) {
        return "{\"kind\": \"scalar\", \"type\": \"" + type + "\", \"refinements\": " + refinements + "}";
    }

    private static String format(String format, String refinements) {
        return "{\"kind\": \"scalar\", \"type\": \"string\", \"format\": \"" + format + "\", \"refinements\": " + refinements + "}";
    }

    @Test
    void countsStringLengthsInCodePoints() {
        String type = scalar("string", "{\"minLength\": 2, \"maxLength\": 3}");

        assertEquals(List.of(), issues("\"ab\"", type));
        assertEquals(List.of(" minLength"), issues("\"😀\"", type));
        assertEquals(List.of(), issues("\"😀😀\"", type));
        assertEquals(List.of(" maxLength"), issues("\"abcd\"", type));
        assertEquals(List.of(" type"), issues("12", type));
    }

    @Test
    void searchesAPatternAndReadsItsAnchorsAsTheWholeString() {
        assertEquals(List.of(), issues("\"abc\"", scalar("string", "{\"pattern\": {\"normalized\": \"b\"}}")));
        assertEquals(List.of(" pattern"), issues("\"abc\"", scalar("string", "{\"pattern\": {\"normalized\": \"^b$\"}}")));
        assertEquals(List.of(), issues("\"b\"", scalar("string", "{\"pattern\": {\"normalized\": \"^b$\"}}")));
        assertEquals(List.of(), issues("\"😀\"", scalar("string", "{\"pattern\": {\"normalized\": \"^\\\\u{1F600}$\"}}")));
        assertEquals(List.of(" pattern"), issues("\"a\\n\"", scalar("string", "{\"pattern\": {\"normalized\": \"^a$\"}}")));
    }

    @Test
    void translatesTheNormalisedPatternToJavaSyntax() {
        assertEquals("\\Aa\\z", StructuralValidator.javaSyntaxOf("^a$"));
        assertEquals("[^a$]", StructuralValidator.javaSyntaxOf("[^a$]"));
        assertEquals("\\^a", StructuralValidator.javaSyntaxOf("\\^a"));
        assertEquals("\\x{1F600}x", StructuralValidator.javaSyntaxOf("\\u{1F600}x"));
    }

    @Test
    void checksTheStringFormats() {
        assertEquals(List.of(), issues("\"123e4567-e89b-12d3-a456-426614174000\"", format("uuid", "{}")));
        assertEquals(List.of(" format"), issues("\"not-a-uuid\"", format("uuid", "{}")));
        assertEquals(List.of(), issues("\"2026-01-31T10:15:30+02:00\"", format("date-time", "{}")));
        assertEquals(List.of(" format"), issues("\"2026-01-31\"", format("date-time", "{}")));
        assertEquals(List.of(" format"), issues("\"2026-13-31T10:15:30Z\"", format("date-time", "{}")));
        assertEquals(List.of(), issues("\"2026-01-31\"", format("date", "{}")));
        assertEquals(List.of(" format"), issues("\"2026-02-30\"", format("date", "{}")));
        assertEquals(List.of(), issues("\"-12.50\"", format("decimal", "{}")));
        assertEquals(List.of(" format"), issues("\"01.5\"", format("decimal", "{}")));
    }

    @Test
    void comparesADecimalsRangeNumericallyNotAsText() {
        String type = format("decimal", "{\"minimum\": \"9.5\", \"maximum\": \"10\"}");

        assertEquals(List.of(), issues("\"9.50\"", type));
        assertEquals(List.of(" minimum"), issues("\"9.49\"", type));
        assertEquals(List.of(" maximum"), issues("\"10.01\"", type));
    }

    @Test
    void refusesAStringFormatTheBoundaryDoesNotValidateByName() {
        IllegalStateException failure = assertThrows(IllegalStateException.class, () -> issues("\"x\"", format("hostname", "{}")));

        assertEquals("seampact: the string format 'hostname' is not one the boundary validates", failure.getMessage());
    }

    @Test
    void checksIntegerBoundsAndTheSafeRange() {
        String bounded = scalar("integer", "{\"minimum\": \"1\", \"maximum\": \"10\", \"multipleOf\": \"5\"}");

        assertEquals(List.of(), issues("5", bounded));
        assertEquals(List.of(" minimum"), issues("0", bounded));
        assertEquals(List.of(" maximum"), issues("15", bounded));
        assertEquals(List.of(" multipleOf"), issues("7", bounded));
        assertEquals(List.of(" type"), issues("1.5", bounded));
        assertEquals(List.of(" type"), issues("\"5\"", bounded));
        assertEquals(List.of(" maximum"), issues("9007199254740993", scalar("integer", "{}")));
        assertEquals(List.of(" minimum"), issues("-9007199254740993", scalar("integer", "{}")));
        assertEquals(List.of(), issues("9007199254740991", scalar("integer", "{}")));
    }

    @Test
    void checksExclusiveBoundsOfANumberAndRefusesANonFiniteOne() {
        String exclusive = scalar("number", "{\"exclusiveMinimum\": \"0\", \"exclusiveMaximum\": \"1\"}");

        assertEquals(List.of(), issues("0.5", exclusive));
        assertEquals(List.of(" exclusiveMinimum"), issues("0", exclusive));
        assertEquals(List.of(" exclusiveMaximum"), issues("1", exclusive));
        assertEquals(List.of(" type"), issues("1e999", scalar("number", "{}")));
        assertEquals(List.of(" type"), issues("true", scalar("number", "{}")));
    }

    @Test
    void checksBooleansAndNulls() {
        assertEquals(List.of(), issues("true", scalar("boolean", "{}")));
        assertEquals(List.of(" type"), issues("\"true\"", scalar("boolean", "{}")));
        assertEquals(List.of(" type"), issues("null", scalar("string", "{}")));
        assertEquals(List.of(), issues("null", "{\"kind\": \"scalar\", \"type\": \"string\", \"nullable\": true, \"refinements\": {}}"));
    }

    @Test
    void anOpaqueValueIsAnyJsonButANumberPastADouble() {
        String opaque = "{\"kind\": \"opaque\"}";

        assertEquals(List.of(), issues("{\"a\": [1, \"x\", null]}", opaque));
        assertEquals(List.of(" type"), issues("{\"a\": [1, 1e999]}", opaque));
        assertEquals(List.of(" type"), issues("null", opaque));
    }

    @Test
    void checksAnEnumAgainstItsValuesOrTheNarrowedOnes() {
        String status = "{\"kind\": \"enum\", \"enum\": \"Status\"}";
        String narrowed = "{\"kind\": \"enum\", \"enum\": \"Status\", \"narrowedTo\": {\"values\": [\"done\"]}}";

        assertEquals(List.of(), issues("\"open\"", status));
        assertEquals(List.of(" enum"), issues("\"closed\"", status));
        assertEquals(List.of(" enum"), issues("1", status));
        assertEquals(List.of(" enum"), issues("\"open\"", narrowed));
        assertEquals(List.of(), issues("\"done\"", narrowed));
    }

    @Test
    void checksArrayLengthsAndEachItemBelowItsIndex() {
        String array = "{\"kind\": \"array\", \"minItems\": 1, \"maxItems\": 2, \"items\": " + scalar("integer", "{}") + "}";

        assertEquals(List.of(), issues("[1, 2]", array));
        assertEquals(List.of(" minItems"), issues("[]", array));
        assertEquals(List.of(" maxItems"), issues("[1, 2, 3]", array));
        assertEquals(List.of("/1 type"), issues("[1, \"x\"]", array));
        assertEquals(List.of(" type"), issues("{}", array));
    }

    @Test
    void reportsAMissingRequiredMemberAndEscapesTheMemberNameInThePointer() {
        String task = "{\"kind\": \"ref\", \"schema\": \"Task\"}";

        assertEquals(List.of("/id required"), issues("{}", task));
        assertEquals(List.of(), issues("{\"id\": \"t\", \"note\": null}", task));
        assertEquals(List.of("/note type"), issues("{\"id\": \"t\", \"note\": 1}", task));
        assertEquals(List.of("/a~1b~0c type"), issues("{\"id\": \"t\", \"a/b~c\": 1}", task));
        assertEquals(List.of(" type"), issues("[]", task));
    }

    @Test
    void appliesTheUnknownKeysPolicy() {
        JsonNode stripped = MAPPER.readTree("{\"id\": \"t\", \"extra\": 1}");
        JsonNode kept = MAPPER.readTree("{\"id\": \"t\", \"extra\": 1}");

        assertEquals(List.of("/extra unknownKeys"), issues("{\"id\": \"t\", \"extra\": 1}", "{\"kind\": \"ref\", \"schema\": \"Task\"}"));
        assertEquals(List.of(), validator.issuesOf(stripped, MAPPER.readTree("{\"kind\": \"ref\", \"schema\": \"Stripped\"}"), "body", "").stream().map(InputIssue::rule).toList());
        assertEquals(MAPPER.readTree("{\"id\": \"t\"}"), stripped);
        assertEquals(List.of(), validator.issuesOf(kept, MAPPER.readTree("{\"kind\": \"ref\", \"schema\": \"Kept\"}"), "body", "").stream().map(InputIssue::rule).toList());
        assertEquals(MAPPER.readTree("{\"id\": \"t\", \"extra\": 1}"), kept);
    }

    @Test
    void refusesATypeKindAScalarTypeAndASchemaKindItDoesNotValidateByName() {
        assertEquals("seampact: the type kind 'map' is not one the boundary validates",
                assertThrows(IllegalStateException.class, () -> issues("{}", "{\"kind\": \"map\"}")).getMessage());
        assertEquals("seampact: the scalar type 'bytes' is not one the boundary validates",
                assertThrows(IllegalStateException.class, () -> issues("1", scalar("bytes", "{}"))).getMessage());
        assertEquals("seampact: the schema kind 'union' is not one the boundary validates",
                assertThrows(IllegalStateException.class, () -> issues("{}", "{\"kind\": \"ref\", \"schema\": \"Union\"}")).getMessage());
    }

    @Test
    void anAbsentValueAtTheTopIsAReportedTypeIssueNotACrash() {
        List<InputIssue> reported = validator.issuesOf(MissingNode.getInstance(), MAPPER.readTree(scalar("string", "{}")), "path", "/id");

        assertEquals(List.of(new InputIssue("path", "/id", "type")), reported);
    }
}
