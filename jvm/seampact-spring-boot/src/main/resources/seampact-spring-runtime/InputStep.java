package io.github.jubasse.seampact.springboot.runtime;

import jakarta.servlet.http.HttpServletRequest;
import java.lang.reflect.RecordComponent;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.InjectableValues;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectReader;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.MissingNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Step 6 (ADR 0022 "Types and validation"): path, query, headers and the held body decoded to a tree by the boundary's
 * own mapper, the structural pass reporting every issue at once, then the binding of the tree to the operation's
 * input record, which cannot fail once the pass found nothing.
 */
final class InputStep {
    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;
    private static final String SCHEMA_INVALID_ROLE = "schemaInvalid";
    private static final int MAX_RENDERED_ISSUES = 100;
    private static final String REFUSE = "refuse";
    private static final String PAGEABLE_COMPONENT = "pageable";
    private static final String PAGEABLE_TYPE = "org.springframework.data.domain.Pageable";

    private InputStep() {}

    static void run(SeampactBoundary boundary, BoundaryExchange exchange, HttpServletRequest request) {
        JsonNode operation = exchange.route().operation();
        List<InputIssue> issues = new ArrayList<>();
        ObjectNode tree = NODES.objectNode();

        tree.set("path", pathParams(boundary, exchange, operation.path("params").path("path"), issues));
        ObjectNode query = queryParams(boundary, operation, request.getQueryString(), issues);
        tree.set("query", query);
        PageReply.checkOnePosition(boundary.table(), exchange.route(), query, issues);
        tree.set("headers", headerParams(boundary, operation.path("params").path("header"), request, issues));
        if (operation.has("input")) tree.set("body", body(boundary, exchange, operation.path("input"), issues));

        if (!issues.isEmpty()) throw schemaInvalid(exchange.route(), issues);

        PageReply.fillLimit(boundary.table(), exchange.route(), query);
        InputFieldRights.apply(boundary, exchange, boundary.requestView(request, exchange), tree.path("body"));
        exchange.query = query;
        exchange.inputTree = tree;
        exchange.input = bind(boundary, exchange.route(), tree);
    }

    /** The `schemaInvalid` refusal of [issues], at most `MAX_RENDERED_ISSUES` of them. */
    static ContractRefusal schemaInvalid(ContractRoute route, List<InputIssue> issues) {
        String code = BoundaryFilter.roleCode(route, SCHEMA_INVALID_ROLE);
        ArrayNode rendered = NODES.arrayNode();
        issues.stream().limit(MAX_RENDERED_ISSUES).forEach(issue ->
                rendered.add(NODES.objectNode().put("in", issue.in()).put("pointer", issue.pointer()).put("rule", issue.rule())));

        return new ContractRefusal(code, ErrorReplies.roleParams(route.roleParams(code, SCHEMA_INVALID_ROLE), Map.of("issues", rendered)));
    }

    private static ObjectNode pathParams(SeampactBoundary boundary, BoundaryExchange exchange, JsonNode params, List<InputIssue> issues) {
        ObjectNode values = NODES.objectNode();

        for (JsonNode param : params) {
            String name = param.path("name").asString();
            String raw = exchange.pathParams().get(name);
            if (raw == null) {
                issues.add(new InputIssue("path", InputIssue.below("", name), "required"));
                continue;
            }

            JsonNode value = WireDecoding.decode(raw, param.path("type"));
            boundary.validator().check(value, param.path("type"), "path", InputIssue.below("", name), issues);
            values.set(name, value);
        }

        return values;
    }

    private static ObjectNode queryParams(SeampactBoundary boundary, JsonNode operation, String rawQuery, List<InputIssue> issues) {
        Map<String, List<String>> members = WireDecoding.queryMembers(rawQuery);
        ObjectNode values = NODES.objectNode();

        for (JsonNode param : operation.path("params").path("query")) {
            String name = param.path("name").asString();
            List<String> sent = members.remove(name);
            String pointer = InputIssue.below("", name);

            if (sent == null) {
                if (param.path("required").asBoolean(false)) issues.add(new InputIssue("query", pointer, "required"));
                continue;
            }

            JsonNode value = queryValue(sent, param.path("type"));
            boundary.validator().check(value, param.path("type"), "query", pointer, issues);
            values.set(name, value);
        }

        if (REFUSE.equals(operation.path("unknownQuery").path("policy").asString(REFUSE))) {
            members.keySet().forEach(name -> issues.add(new InputIssue("query", InputIssue.below("", name), "unknownKeys")));
        }

        return values;
    }

    // An array parameter takes every value of its name; any other parameter sent twice is a `type` issue.
    private static JsonNode queryValue(List<String> sent, JsonNode typeUse) {
        if ("array".equals(typeUse.path("kind").asString())) {
            ArrayNode items = NODES.arrayNode();
            sent.forEach(text -> items.add(WireDecoding.decode(text, typeUse.path("items"))));
            return items;
        }

        if (sent.size() > 1) {
            ArrayNode repeated = NODES.arrayNode();
            sent.forEach(repeated::add);
            return repeated;
        }

        return WireDecoding.decode(sent.get(0), typeUse);
    }

    private static ObjectNode headerParams(SeampactBoundary boundary, JsonNode params, HttpServletRequest request, List<InputIssue> issues) {
        ObjectNode values = NODES.objectNode();

        for (JsonNode param : params) {
            String name = param.path("name").asString();
            List<String> sent = Collections.list(request.getHeaders(name));
            String pointer = InputIssue.below("", name.toLowerCase(Locale.ROOT));

            if (sent.isEmpty()) {
                if (param.path("required").asBoolean(false)) issues.add(new InputIssue("header", pointer, "required"));
                continue;
            }

            JsonNode value = WireDecoding.decode(String.join(", ", sent), param.path("type"));
            boundary.validator().check(value, param.path("type"), "header", pointer, issues);
            values.set(name, value);
        }

        return values;
    }

    private static JsonNode body(SeampactBoundary boundary, BoundaryExchange exchange, JsonNode input, List<InputIssue> issues) {
        if (exchange.body == null) {
            issues.add(new InputIssue("body", "", "required"));
            return MissingNode.getInstance();
        }

        JsonNode body;
        try {
            body = boundary.mapper().readTree(exchange.body);
        } catch (JacksonException malformed) {
            issues.add(new InputIssue("body", "", "type"));
            return MissingNode.getInstance();
        }

        if (!(body instanceof ObjectNode members) || input.path("proofs").isEmpty()) {
            boundary.validator().check(body, input.path("schema"), "body", "", issues);
            return body;
        }

        // The proof fields of the operation's rules sit beside the body schema's members; the handler never sees them.
        ObjectNode withoutProofs = members.deepCopy();
        for (JsonNode proof : input.path("proofs")) {
            issues.addAll(proofIssues(boundary, members, proof));
            withoutProofs.remove(proof.path("name").asString());
        }
        boundary.validator().check(withoutProofs, input.path("schema"), "body", "", issues);

        return withoutProofs;
    }

    /** The issues of one rule proof field of [body]: required, and checked by its own schema. */
    static List<InputIssue> proofIssues(SeampactBoundary boundary, JsonNode body, JsonNode proof) {
        String name = proof.path("name").asString();
        String pointer = InputIssue.below("", name);
        JsonNode member = body.path(name);
        if (member.isMissingNode()) return List.of(new InputIssue("body", pointer, "required"));

        return boundary.validator().issuesOf(member, proof.path("schema"), "body", pointer);
    }

    // A `springPage` list's input record holds the `Pageable` the boundary injects (ADR 0022 "Paging").
    private static boolean takesPageable(Class<?> inputType) {
        for (RecordComponent component : inputType.getRecordComponents()) {
            if (PAGEABLE_COMPONENT.equals(component.getName()) && PAGEABLE_TYPE.equals(component.getType().getName())) return true;
        }

        return false;
    }

    // The tree holds every part; the record takes the parts the operation declares, by its component names.
    private static Object bind(SeampactBoundary boundary, ContractRoute route, ObjectNode tree) {
        Class<?> inputType = boundary.binding().inputTypes().get(route.id());
        ObjectNode parts = NODES.objectNode();
        for (RecordComponent component : inputType.getRecordComponents()) {
            parts.set(component.getName(), tree.path(component.getName()));
        }

        ObjectReader reader = boundary.mapper().readerFor(inputType);
        if (takesPageable(inputType)) {
            Object pageable = boundary.binding().pageable(boundary.table().pagingStyle(route), tree.path("query"));
            reader = reader.with(new InjectableValues.Std().addValue(PAGEABLE_COMPONENT, pageable));
        }

        try {
            return reader.readValue(parts);
        } catch (JacksonException failure) {
            throw new IllegalStateException("seampact: binding the validated input of '" + route.id() + "' to " + inputType.getName() + " failed", failure);
        }
    }
}
