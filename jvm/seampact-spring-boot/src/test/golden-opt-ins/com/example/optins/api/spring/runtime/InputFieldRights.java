package com.example.optins.api.spring.runtime;

import io.github.jubasse.seampact.hooks.Decision;
import io.github.jubasse.seampact.hooks.FieldDirection;
import io.github.jubasse.seampact.hooks.Purpose;
import io.github.jubasse.seampact.hooks.RequestView;
import io.github.jubasse.seampact.hooks.RequirementKind;
import io.github.jubasse.seampact.hooks.RequirementRequest;
import io.github.jubasse.seampact.hooks.SubjectRef;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Step 7 of the check order (ADR 0012 "Field rights"): a restricted input field sent without its right is refused
 * with its pointer, or removed from the body under `inputPolicy: strip`. Only top-level members are restricted.
 */
final class InputFieldRights {
    private static final String INPUT = "input";
    private static final String STRIP = "strip";
    private static final String FORBIDDEN_ROLE = "forbidden";

    private InputFieldRights() {}

    static void apply(SeampactBoundary boundary, BoundaryExchange exchange, RequestView view, JsonNode body) {
        if (!(body instanceof ObjectNode members)) return;

        for (JsonNode fieldRight : exchange.route().operation().path("fieldRights")) {
            if (!INPUT.equals(fieldRight.path("direction").asString())) continue;

            String pointer = fieldRight.path("pointer").asString();
            String member = topLevelMember(pointer);
            if (!members.has(member)) continue;

            Decision<Denial> decision = decide(boundary, exchange, view, fieldRight, pointer);
            if (!(decision instanceof Decision.Denied<Denial> denied)) continue;

            if (STRIP.equals(fieldRight.path("inputPolicy").asString())) {
                members.remove(member);
                continue;
            }

            throw forbiddenRefusal(boundary, exchange.route(), denied.deny(), pointer);
        }
    }

    private static Decision<Denial> decide(SeampactBoundary boundary, BoundaryExchange exchange, RequestView view, JsonNode fieldRight, String pointer) {
        String right = fieldRight.path("right").asString();
        Optional<SubjectRef<Object, Object>> subject = AccessSteps.subjectOf(boundary, exchange, fieldRight.path("subject"), right);
        Optional<JsonNode> params = fieldRight.has("params") ? Optional.of(fieldRight.path("params")) : Optional.empty();

        return AccessSteps.decide(boundary, right, new RequirementCall(RequirementKind.RIGHT, right, params, exchange.principal,
                subject, List.copyOf(exchange.scopes), Optional.empty(), Optional.empty(), new Purpose.Field(pointer, FieldDirection.INPUT),
                boundary.operationRef(exchange.route()), view, new RequirementRequest.Extensions<>(Map.of(), Map.of())));
    }

    // The decider's params, with the field's pointer when the code binds the `forbidden` role's data.
    private static ContractRefusal forbiddenRefusal(SeampactBoundary boundary, ContractRoute route, Denial denial, String pointer) {
        ContractRefusal refusal = AccessSteps.refusalOf(boundary, denial);
        JsonNode rendered = ErrorReplies.roleParams(route.roleParams(denial.code(), FORBIDDEN_ROLE), Map.of("pointer", boundary.mapper().valueToTree(pointer)));
        if (!(rendered instanceof ObjectNode renderedParams)) return refusal;

        ObjectNode merged = refusal.params() instanceof ObjectNode denialParams ? denialParams.deepCopy() : renderedParams.objectNode();
        merged.setAll(renderedParams);

        return new ContractRefusal(denial.code(), merged);
    }

    private static String topLevelMember(String pointer) {
        return pointer.substring(1).replace("~1", "/").replace("~0", "~");
    }
}
