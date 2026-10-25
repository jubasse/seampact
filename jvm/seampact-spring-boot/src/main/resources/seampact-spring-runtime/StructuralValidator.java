package io.github.jubasse.seampact.springboot.runtime;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Step 6's structural pass (ADR 0022 "Types and validation"): it walks a decoded value against the contract's type
 * with no coercion and reports every issue with its pointer and the contract rule (`required`, `type`, `enum`,
 * `unknownKeys`, `minLength`...). String lengths count code points, `pattern` is a search as in ECMA-262, and an
 * integer outside a Java `long` is a `type` issue. Unknown keys a schema strips are removed from the value.
 */
final class StructuralValidator {
    private static final Pattern UUID_TEXT = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private static final Pattern DECIMAL_TEXT = Pattern.compile("-?(0|[1-9][0-9]*)(\\.[0-9]+)?");
    private static final String DECIMAL_FORMAT = "decimal";
    private static final String UNKNOWN_KEYS_STRIP = "strip";
    private static final String UNKNOWN_KEYS_KEEP = "keep";

    private final ContractTable table;
    private final Map<String, Pattern> patterns = new ConcurrentHashMap<>();

    StructuralValidator(ContractTable table) {
        this.table = table;
    }

    /** The issues of [value] (a missing node when absent) against [typeUse], below [pointer] of the input part [in]. */
    List<InputIssue> issuesOf(JsonNode value, JsonNode typeUse, String in, String pointer) {
        List<InputIssue> issues = new ArrayList<>();
        check(value, typeUse, in, pointer, issues);

        return issues;
    }

    void check(JsonNode value, JsonNode typeUse, String in, String pointer, List<InputIssue> issues) {
        if (value.isNull()) {
            if (!typeUse.path("nullable").asBoolean(false)) issues.add(new InputIssue(in, pointer, "type"));
            return;
        }

        switch (typeUse.path("kind").asString()) {
            case "scalar" -> checkScalar(value, typeUse, in, pointer, issues);
            case "enum" -> checkEnum(value, typeUse, in, pointer, issues);
            case "array" -> checkArray(value, typeUse, in, pointer, issues);
            case "ref" -> checkSchema(value, table.schema(typeUse.path("schema").asString()), in, pointer, issues);
            case "opaque" -> {}
            default -> throw new IllegalStateException(
                    "seampact: the type kind '" + typeUse.path("kind").asString() + "' is not one the boundary validates");
        }
    }

    private void checkScalar(JsonNode value, JsonNode typeUse, String in, String pointer, List<InputIssue> issues) {
        JsonNode refinements = typeUse.path("refinements");

        switch (typeUse.path("type").asString()) {
            case "string" -> {
                if (!value.isString()) {
                    issues.add(new InputIssue(in, pointer, "type"));
                    return;
                }
                checkString(value.asString(), typeUse, refinements, in, pointer, issues);
            }
            case "integer" -> {
                if (!value.isIntegralNumber() || !value.canConvertToLong()) {
                    issues.add(new InputIssue(in, pointer, "type"));
                    return;
                }
                checkBounds(value.decimalValue(), refinements, in, pointer, issues);
            }
            case "number" -> {
                if (!value.isNumber()) {
                    issues.add(new InputIssue(in, pointer, "type"));
                    return;
                }
                checkBounds(value.decimalValue(), refinements, in, pointer, issues);
            }
            case "boolean" -> {
                if (!value.isBoolean()) issues.add(new InputIssue(in, pointer, "type"));
            }
            default -> throw new IllegalStateException(
                    "seampact: the scalar type '" + typeUse.path("type").asString() + "' is not one the boundary validates");
        }
    }

    private void checkString(String text, JsonNode typeUse, JsonNode refinements, String in, String pointer, List<InputIssue> issues) {
        int length = text.codePointCount(0, text.length());
        if (refinements.has("minLength") && length < refinements.path("minLength").asInt()) issues.add(new InputIssue(in, pointer, "minLength"));
        if (refinements.has("maxLength") && length > refinements.path("maxLength").asInt()) issues.add(new InputIssue(in, pointer, "maxLength"));

        if (refinements.has("pattern")) {
            Pattern pattern = patterns.computeIfAbsent(refinements.path("pattern").asString(), Pattern::compile);
            if (!pattern.matcher(text).find()) issues.add(new InputIssue(in, pointer, "pattern"));
        }

        if (!typeUse.has("format")) return;

        String format = typeUse.path("format").asString();
        if (!matchesFormat(text, format)) {
            issues.add(new InputIssue(in, pointer, "format"));
            return;
        }

        // A decimal's range refinements compare numerically (ADR 0003 section 8).
        if (format.equals(DECIMAL_FORMAT)) checkBounds(new BigDecimal(text), refinements, in, pointer, issues);
    }

    private static boolean matchesFormat(String text, String format) {
        try {
            return switch (format) {
                case "uuid" -> UUID_TEXT.matcher(text).matches();
                case "date-time" -> OffsetDateTime.parse(text, DateTimeFormatter.ISO_OFFSET_DATE_TIME) != null && text.matches(".*T\\d{2}:\\d{2}:\\d{2}.*");
                case "date" -> LocalDate.parse(text, DateTimeFormatter.ISO_LOCAL_DATE) != null;
                case DECIMAL_FORMAT -> DECIMAL_TEXT.matcher(text).matches();
                default -> throw new IllegalStateException("seampact: the string format '" + format + "' is not one the boundary validates");
            };
        } catch (DateTimeParseException invalid) {
            return false;
        }
    }

    private static void checkBounds(BigDecimal number, JsonNode refinements, String in, String pointer, List<InputIssue> issues) {
        if (refinements.has("minimum") && number.compareTo(new BigDecimal(refinements.path("minimum").asString())) < 0) issues.add(new InputIssue(in, pointer, "minimum"));
        if (refinements.has("maximum") && number.compareTo(new BigDecimal(refinements.path("maximum").asString())) > 0) issues.add(new InputIssue(in, pointer, "maximum"));
        if (refinements.has("exclusiveMinimum") && number.compareTo(new BigDecimal(refinements.path("exclusiveMinimum").asString())) <= 0) issues.add(new InputIssue(in, pointer, "exclusiveMinimum"));
        if (refinements.has("exclusiveMaximum") && number.compareTo(new BigDecimal(refinements.path("exclusiveMaximum").asString())) >= 0) issues.add(new InputIssue(in, pointer, "exclusiveMaximum"));

        if (refinements.has("multipleOf")) {
            BigDecimal divisor = new BigDecimal(refinements.path("multipleOf").asString());
            if (number.remainder(divisor).signum() != 0) issues.add(new InputIssue(in, pointer, "multipleOf"));
        }
    }

    private void checkEnum(JsonNode value, JsonNode typeUse, String in, String pointer, List<InputIssue> issues) {
        JsonNode values = typeUse.path("narrowedTo").has("values")
                ? typeUse.path("narrowedTo").path("values")
                : table.enumeration(typeUse.path("enum").asString()).path("values");

        for (JsonNode allowed : values) {
            if (value.isString() && allowed.asString().equals(value.asString())) return;
        }

        issues.add(new InputIssue(in, pointer, "enum"));
    }

    private void checkArray(JsonNode value, JsonNode typeUse, String in, String pointer, List<InputIssue> issues) {
        if (!value.isArray()) {
            issues.add(new InputIssue(in, pointer, "type"));
            return;
        }

        if (typeUse.has("minItems") && value.size() < typeUse.path("minItems").asInt()) issues.add(new InputIssue(in, pointer, "minItems"));
        if (typeUse.has("maxItems") && value.size() > typeUse.path("maxItems").asInt()) issues.add(new InputIssue(in, pointer, "maxItems"));

        for (int index = 0; index < value.size(); index++) {
            check(value.get(index), typeUse.path("items"), in, pointer + "/" + index, issues);
        }
    }

    private void checkSchema(JsonNode value, JsonNode schema, String in, String pointer, List<InputIssue> issues) {
        if (!"object".equals(schema.path("kind").asString())) {
            throw new IllegalStateException("seampact: the schema kind '" + schema.path("kind").asString() + "' is not one the boundary validates");
        }

        if (!(value instanceof ObjectNode object)) {
            issues.add(new InputIssue(in, pointer, "type"));
            return;
        }

        Set<String> declared = new HashSet<>();
        for (JsonNode property : schema.path("properties")) {
            String name = property.path("name").asString();
            declared.add(name);
            JsonNode member = object.path(name);

            if (member.isMissingNode()) {
                if (!property.path("optional").asBoolean(false)) issues.add(new InputIssue(in, InputIssue.below(pointer, name), "required"));
            } else if (member.isNull() && property.path("nullable").asBoolean(false)) {
                continue;
            } else {
                check(member, property.path("type"), in, InputIssue.below(pointer, name), issues);
            }
        }

        checkUnknownKeys(object, declared, schema.path("unknownKeys").path("policy").asString(""), in, pointer, issues);
    }

    private static void checkUnknownKeys(ObjectNode object, Set<String> declared, String policy, String in, String pointer, List<InputIssue> issues) {
        if (UNKNOWN_KEYS_KEEP.equals(policy)) return;

        List<String> unknown = object.propertyNames().stream().filter(name -> !declared.contains(name)).toList();
        if (UNKNOWN_KEYS_STRIP.equals(policy)) {
            unknown.forEach(object::remove);
            return;
        }

        unknown.forEach(name -> issues.add(new InputIssue(in, InputIssue.below(pointer, name), "unknownKeys")));
    }
}
