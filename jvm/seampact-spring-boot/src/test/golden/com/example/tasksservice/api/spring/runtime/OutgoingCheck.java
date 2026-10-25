package com.example.tasksservice.api.spring.runtime;

import java.io.IOException;
import java.util.Map;
import java.util.Optional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.MissingNode;

/**
 * The verdict on a contract route's held reply (ADR 0022 "The outgoing response check"): a declared status, a
 * success the reply handler wrote, an error in the api's format with a code the status lists, a mark on every
 * reply of an admitted request, and no change after the boundary wrote. A 401, 403 or 429 by `sendError` or with an
 * empty body answers its role's reply when the operation declares it. Under `strict` a violation is the api's 500;
 * under `warn` it goes out and is logged.
 */
final class OutgoingCheck {
    private static final Map<Integer, String> REFUSAL_ROLES = Map.of(401, "unauthenticated", 403, "forbidden", 429, "rateLimited");
    private static final int NOT_MODIFIED = 304;

    private OutgoingCheck() {}

    /** Gives the verdict; a failure of the check itself is the api's 500, never the container's. */
    static void finish(SeampactBoundary boundary, BoundaryExchange exchange) {
        try {
            check(boundary, exchange);
        } catch (RuntimeException failure) {
            boundary.writeUnexpected(exchange, "the outgoing check failed", failure);
            release(boundary, exchange, exchange.response.heldBody());
        }
    }

    private static void check(SeampactBoundary boundary, BoundaryExchange exchange) {
        CheckingResponse response = exchange.response;
        byte[] body = response.heldBody();
        int status = response.heldStatus();

        if (!exchange.boundaryWrote && (response.errorSent() || (body.length == 0 && REFUSAL_ROLES.containsKey(status)))) {
            Optional<String> code = refusalCode(exchange.route(), status);
            if (code.isPresent()) {
                response.clearKeepingHeaders();
                boundary.writeError(response, exchange.route(), code.get(), MissingNode.getInstance());
                release(boundary, exchange, response.heldBody());
                return;
            }
        }

        Optional<String> violation = exchange.violation.or(() -> violationOf(boundary, exchange, status, body));
        if (violation.isEmpty()) {
            release(boundary, exchange, body);
            return;
        }

        if (boundary.isStrict(exchange.route().id())) {
            boundary.writeUnexpected(exchange, violation.get(), null);
            release(boundary, exchange, response.heldBody());
            return;
        }

        SeampactBoundary.LOG.warn("seampact: the reply of {}.{} breaks the contract ({}); sent as written under 'responses: warn'",
                boundary.apiId(), exchange.route().id(), violation.get());
        release(boundary, exchange, body);
    }

    private static Optional<String> violationOf(SeampactBoundary boundary, BoundaryExchange exchange, int status, byte[] body) {
        if (exchange.boundaryWrote) {
            return exchange.response.changedSinceBoundaryReply() ? Optional.of("the reply changed after the boundary wrote it") : Optional.empty();
        }

        ContractRoute route = exchange.route();
        if (exchange.response.errorSent()) return Optional.of("the status " + status + " was sent with sendError and no body");
        if (!route.declaresStatus(status)) return Optional.of("the status " + status + " is not declared");

        boolean success = (status >= 200 && status < 300) || status == NOT_MODIFIED;
        if (success) return Optional.of("a success the reply handler did not write");
        if (exchange.admitted && !exchange.exceptionSeen) return Optional.of("a reply neither the reply handler nor the exception resolver handled");

        return errorBodyViolation(boundary, route, status, body, exchange.response.getContentType());
    }

    // A declared error: in the api's error media, with a code the operation lists for this status.
    private static Optional<String> errorBodyViolation(SeampactBoundary boundary, ContractRoute route, int status, byte[] body, String contentType) {
        String media = ErrorReplies.media(boundary.table(), route);
        if (contentType == null || !contentType.split(";", 2)[0].trim().equalsIgnoreCase(media)) {
            return Optional.of("the error body of status " + status + " is not in " + media);
        }

        JsonNode parsed;
        try {
            parsed = boundary.mapper().readTree(body);
        } catch (JacksonException notJson) {
            return Optional.of("the error body of status " + status + " is not JSON");
        }

        for (JsonNode member : boundary.table().format(route).path("error").path("body").path("members")) {
            if (!"code".equals(member.path("value").path("slot").asString())) continue;
            String code = parsed.path(member.path("name").path("text").asString()).asString("");
            if (route.statusOf(code).orElse(-1) == status) return Optional.empty();
        }

        return Optional.of("the error body of status " + status + " carries no code the operation lists for it");
    }

    // Only 401, 403 and 429 answer their role's code; any other status by sendError is a violation.
    private static Optional<String> refusalCode(ContractRoute route, int status) {
        String role = REFUSAL_ROLES.get(status);
        if (role == null) return Optional.empty();

        return route.codeOfRole(role).filter(code -> route.statusOf(code).orElse(-1) == status);
    }

    private static void release(SeampactBoundary boundary, BoundaryExchange exchange, byte[] body) {
        IdempotencyStep.settle(boundary, exchange, body);
        try {
            exchange.response.release(body);
        } catch (IOException failure) {
            SeampactBoundary.LOG.error("seampact: writing the reply of {}.{} failed", boundary.apiId(), exchange.route().id(), failure);
            boundary.report(Optional.of(exchange.route().id()), "writing the reply failed", failure);
        }
    }
}
