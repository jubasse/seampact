package com.example.tasksservice.api.spring.runtime;

import io.github.jubasse.seampact.hooks.IdempotencyBegin;
import io.github.jubasse.seampact.hooks.IdempotencyClaim;
import io.github.jubasse.seampact.hooks.IdempotencyStore;
import io.github.jubasse.seampact.hooks.StoredResponse;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.MissingNode;

/**
 * Idempotency at the boundary (ADR 0012 obligations): the claim's fixed-size key and fingerprint after step 6, the
 * replay, running and mismatch answers, and the record completed or abandoned with the reply that went out.
 */
final class IdempotencyStep {
    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;
    private static final String DERIVED = "derived";
    private static final String BOUNDARY = "boundary";
    private static final String IN_PROGRESS_ROLE = "idempotencyInProgress";
    private static final String KEY_REUSED_ROLE = "idempotencyKeyReused";
    private static final String CONTENT_TYPE = "content-type";
    private static final String REPLAYED = "true";
    private static final int CLIENT_ERROR_FLOOR = 400;
    private static final int SERVER_ERROR_FLOOR = 500;

    private IdempotencyStep() {}

    /**
     * Claims the request's key; true when the stored reply was replayed and the handler must not run. A request
     * without a key, or to an operation that is not idempotent, claims nothing.
     */
    static boolean begin(SeampactBoundary boundary, BoundaryExchange exchange) throws IOException {
        ContractRoute route = exchange.route();
        JsonNode idempotency = route.operation().path("idempotency");
        if (!DERIVED.equals(idempotency.path("kind").asString()) || !BOUNDARY.equals(idempotency.path("enforce").asString())) return false;

        JsonNode clientKey = exchange.inputTree.path("headers").path(idempotency.path("header").asString());
        if (!clientKey.isString()) return false;

        IdempotencyStore store = boundary.idempotencyStore();
        String key = Digests.hexOf(List.of(
                NODES.stringNode(boundary.apiId()),
                NODES.stringNode(route.id()),
                NODES.stringNode(route.operation().path("access").path("identity").asString("")),
                NODES.stringNode(principalDigest(boundary, exchange)),
                clientKey));
        // The decoded input holds the decoded path params, so an equivalent encoding of the path is the same request.
        String fingerprint = Digests.hexOf(List.of(
                NODES.stringNode(route.operation().path("method").asString()),
                NODES.stringNode(route.operation().path("path").asString()),
                exchange.inputTree));

        IdempotencyBegin begun = store.begin(new IdempotencyClaim(key, fingerprint, idempotency.path("lifetimeMs").asLong(), boundary.operationRef(route)));
        switch (begun) {
            case IdempotencyBegin.Started started -> {
                exchange.idempotencyKey = key;
                return false;
            }
            case IdempotencyBegin.Running running -> throw refusal(route, IN_PROGRESS_ROLE);
            case IdempotencyBegin.Mismatch mismatch -> throw refusal(route, KEY_REUSED_ROLE);
            case IdempotencyBegin.Replay replay -> {
                replay(exchange, replay.response(), idempotency.path("replayHeader").asString());
                return true;
            }
        }
    }

    /** Completes the claimed record with the reply that went out, or abandons it after a server error. */
    static void settle(SeampactBoundary boundary, BoundaryExchange exchange, byte[] body) {
        String key = exchange.idempotencyKey;
        if (key == null) return;

        exchange.idempotencyKey = null;
        CheckingResponse response = exchange.response;
        try {
            IdempotencyStore store = boundary.idempotencyStore();
            if (response.heldStatus() >= SERVER_ERROR_FLOOR) store.abandon(key);
            else store.complete(key, new StoredResponse(response.heldStatus(), storedHeaders(response), body));
        } catch (RuntimeException failure) {
            SeampactBoundary.LOG.error("seampact: the idempotency store failed to record the reply of {}.{}; a retry with the same key may run"
                    + " again. Check the store's backend.", boundary.apiId(), exchange.route().id(), failure);
        }
    }

    private static String principalDigest(SeampactBoundary boundary, BoundaryExchange exchange) {
        if (exchange.principal == null) return "";

        return Digests.hexOf(List.of(boundary.mapper().valueToTree(exchange.principal)));
    }

    private static List<StoredResponse.Header> storedHeaders(CheckingResponse response) {
        List<StoredResponse.Header> headers = new ArrayList<>();
        if (response.getContentType() != null) headers.add(new StoredResponse.Header(CONTENT_TYPE, response.getContentType()));
        for (String name : response.getHeaderNames()) {
            String lowerName = name.toLowerCase(Locale.ROOT);
            if (lowerName.equals(CONTENT_TYPE)) continue;
            for (String value : response.getHeaders(name)) headers.add(new StoredResponse.Header(lowerName, value));
        }

        return headers;
    }

    // The stored reply as it went out; a stored success carries the replay header.
    private static void replay(BoundaryExchange exchange, StoredResponse stored, String replayHeader) throws IOException {
        CheckingResponse response = exchange.response;
        for (StoredResponse.Header header : stored.headers()) {
            if (header.name().equalsIgnoreCase(replayHeader)) continue;
            if (header.name().equals(CONTENT_TYPE)) response.setContentType(header.value());
            else response.addHeader(header.name(), header.value());
        }
        if (stored.status() < CLIENT_ERROR_FLOOR) response.setHeader(replayHeader, REPLAYED);

        response.getOutputStream().write(stored.body());
        response.setStatus(stored.status());
        exchange.markBoundaryWrote();
    }

    private static ContractRefusal refusal(ContractRoute route, String role) {
        return new ContractRefusal(BoundaryFilter.roleCode(route, role), MissingNode.getInstance());
    }
}
