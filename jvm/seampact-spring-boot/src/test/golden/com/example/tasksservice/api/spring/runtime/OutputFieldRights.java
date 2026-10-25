package com.example.tasksservice.api.spring.runtime;

import io.github.jubasse.seampact.hooks.Decision;
import io.github.jubasse.seampact.hooks.FieldDirection;
import io.github.jubasse.seampact.hooks.Purpose;
import io.github.jubasse.seampact.hooks.RequestView;
import io.github.jubasse.seampact.hooks.RequirementKind;
import io.github.jubasse.seampact.hooks.RequirementRequest;
import io.github.jubasse.seampact.hooks.SubjectRef;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Restricted output fields (ADR 0012 "Field rights"): before the reply is written, each restricted member whose
 * right the decider denies for its holder is removed. One decision is asked per right and subject.
 */
final class OutputFieldRights {
    private static final String OUTPUT = "output";
    private static final String WILDCARD = "*";

    private OutputFieldRights() {}

    static void apply(SeampactBoundary boundary, BoundaryExchange exchange, RequestView view, JsonNode response, JsonNode body) {
        Map<String, Boolean> decisions = new HashMap<>();

        for (JsonNode fieldRight : exchange.route().operation().path("fieldRights")) {
            if (!OUTPUT.equals(fieldRight.path("direction").asString())) continue;
            if (!fieldRight.path("schema").asString().equals(response.path("body").path("schema").asString())) continue;

            String[] segments = fieldRight.path("pointer").asString().substring(1).split("/");
            for (JsonNode instance : schemaInstances(body, response.path("shape").asString())) {
                for (ObjectNode holder : holders(instance, segments)) {
                    String member = segments[segments.length - 1];
                    if (holder.has(member) && !allowed(boundary, exchange, view, fieldRight, holder, decisions)) holder.remove(member);
                }
            }
        }
    }

    // A table's values and a list's items are each an instance of the body's schema.
    static List<JsonNode> schemaInstances(JsonNode body, String shape) {
        List<JsonNode> instances = new ArrayList<>();
        switch (shape) {
            case "table" -> body.properties().forEach(entry -> instances.add(entry.getValue()));
            case "list", "page" -> body.forEach(instances::add);
            default -> instances.add(body);
        }

        return instances;
    }

    // The objects holding the pointer's last member; `*` walks every item of an array.
    private static List<ObjectNode> holders(JsonNode instance, String[] segments) {
        List<JsonNode> current = List.of(instance);
        for (int index = 0; index < segments.length - 1; index++) {
            List<JsonNode> next = new ArrayList<>();
            for (JsonNode node : current) {
                if (WILDCARD.equals(segments[index])) node.forEach(next::add);
                else if (node.has(segments[index])) next.add(node.get(segments[index]));
            }
            current = next;
        }

        List<ObjectNode> objects = new ArrayList<>();
        current.forEach(node -> {
            if (node instanceof ObjectNode object) objects.add(object);
        });

        return objects;
    }

    private static boolean allowed(SeampactBoundary boundary, BoundaryExchange exchange, RequestView view, JsonNode fieldRight, ObjectNode holder, Map<String, Boolean> decisions) {
        String right = fieldRight.path("right").asString();
        Optional<SubjectRef<Object, Object>> subject = subjectOf(boundary, fieldRight, right, holder);
        String key = right + "\n" + subject.map(ref -> String.valueOf(ref.id())).orElse("");

        return decisions.computeIfAbsent(key, ignored -> {
            Optional<JsonNode> params = fieldRight.has("params") ? Optional.of(fieldRight.path("params")) : Optional.empty();
            RequirementCall call = new RequirementCall(RequirementKind.RIGHT, right, params, exchange.principal, subject,
                    List.copyOf(exchange.scopes), Optional.empty(), Optional.empty(),
                    new Purpose.Field(fieldRight.path("pointer").asString(), FieldDirection.OUTPUT),
                    boundary.operationRef(exchange.route()), view, new RequirementRequest.Extensions<>(Map.of(), Map.of()));

            return AccessSteps.decide(boundary, right, call) instanceof Decision.Allowed<Denial>;
        });
    }

    private static Optional<SubjectRef<Object, Object>> subjectOf(SeampactBoundary boundary, JsonNode fieldRight, String right, ObjectNode holder) {
        JsonNode source = fieldRight.path("subject").path("source");
        if (!"holderField".equals(source.path("in").asString())) return Optional.empty();

        JsonNode rightSubject = boundary.table().ir().path("rights").path(right).path("subject");
        JsonNode id = holder.path(source.path("name").asString());
        if (id.isMissingNode()) return Optional.empty();

        return Optional.of(new SubjectRef<>(AccessSteps.subjectType(rightSubject), ScalarValues.of(id, rightSubject.path("idSchema")), Optional.empty()));
    }
}
