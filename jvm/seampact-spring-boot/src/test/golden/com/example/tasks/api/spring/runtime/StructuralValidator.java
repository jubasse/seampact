package com.example.tasks.api.spring.runtime;

import java.math.BigDecimal;
import java.math.BigInteger;
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
 * integer past the safe range of a double is a `minimum` or `maximum` issue, a non-finite number a `type` issue. Unknown keys a schema strips are removed from the value.
 */
final class StructuralValidator {
    private static final Pattern UUID_TEXT = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private static final Pattern DECIMAL_TEXT = Pattern.compile("-?(0|[1-9][0-9]*)(\\.[0-9]+)?");
    // ADR 0003 keeps a plain integer in the safe range of a double, as the Node and PHP targets check it.
    private static final BigInteger LARGEST_SAFE_INTEGER = BigInteger.valueOf(9007199254740991L);
    private static final String DECIMAL_FORMAT = "decimal";
    private static final String OPAQUE = "opaque";
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
        // An opaque value is any JSON, null only when nullable, but a number past the range of a double, at any depth.
        if (OPAQUE.equals(typeUse.path("kind").asString())) {
            if (!isFiniteThroughout(value)) issues.add(new InputIssue(in, pointer, "type"));
            return;
        }

        switch (typeUse.path("kind").asString()) {
            case "scalar" -> checkScalar(value, typeUse, in, pointer, issues);
            case "enum" -> checkEnum(value, typeUse, in, pointer, issues);
            case "array" -> checkArray(value, typeUse, in, pointer, issues);
            case "ref" -> checkSchema(value, table.schema(typeUse.path("schema").asString()), in, pointer, issues);
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
                if (!value.isIntegralNumber()) {
                    issues.add(new InputIssue(in, pointer, "type"));
                    return;
                }
                if (isBeyondSafeInteger(value.bigIntegerValue())) {
                    issues.add(new InputIssue(in, pointer, value.bigIntegerValue().signum() < 0 ? "minimum" : "maximum"));
                    return;
                }
                checkBounds(value.decimalValue(), refinements, in, pointer, issues);
            }
            case "number" -> {
                // A literal past the range of a double is Infinity, whatever node holds it, and no handler takes it.
                if (!value.isNumber() || !Double.isFinite(value.doubleValue())) {
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

    private static boolean isFiniteThroughout(JsonNode value) {
        if (value.isNumber()) return Double.isFinite(value.doubleValue());

        for (JsonNode member : value) {
            if (!isFiniteThroughout(member)) return false;
        }

        return true;
    }

    private static boolean isBeyondSafeInteger(BigInteger integer) {
        return integer.abs().compareTo(LARGEST_SAFE_INTEGER) > 0;
    }

    private void checkString(String text, JsonNode typeUse, JsonNode refinements, String in, String pointer, List<InputIssue> issues) {
        int length = text.codePointCount(0, text.length());
        if (refinements.has("minLength") && length < refinements.path("minLength").asInt()) issues.add(new InputIssue(in, pointer, "minLength"));
        if (refinements.has("maxLength") && length > refinements.path("maxLength").asInt()) issues.add(new InputIssue(in, pointer, "maxLength"));

        if (refinements.has("pattern")) {
            String normalized = refinements.path("pattern").path("normalized").asString();
            Pattern pattern = patterns.computeIfAbsent(normalized, written -> Pattern.compile(javaSyntaxOf(written)));
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

    /**
     * The normalised pattern (ADR 0003 section 9, ECMAScript `u` syntax) in java.util.regex syntax, run with `find()`:
     * `^` and `$` outside a class mean the start and the end of the string (Java's A and z anchors), and an astral code
     * point escape takes Java's `x{...}` form. Every other construct of the normalised form reads the same in both engines.
     */
    static String javaSyntaxOf(String normalized) {
        StringBuilder java = new StringBuilder();
        boolean inClass = false;
        int index = 0;

        while (index < normalized.length()) {
            char current = normalized.charAt(index);
            if (current == '\\') {
                index = appendEscape(normalized, index, java);
                continue;
            }

            if (current == '[') inClass = true;
            else if (current == ']') inClass = false;

            if (!inClass && current == '^') java.append("\\A");
            else if (!inClass && current == '$') java.append("\\z");
            else java.append(current);
            index++;
        }

        return java.toString();
    }

    // Appends the escape starting at [start] and returns the index after it.
    private static int appendEscape(String normalized, int start, StringBuilder java) {
        if (normalized.startsWith("\\u{", start)) {
            int end = normalized.indexOf('}', start);
            java.append("\\x{").append(normalized, start + 3, end + 1);
            return end + 1;
        }

        java.append(normalized, start, start + 2);
        return start + 2;
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
