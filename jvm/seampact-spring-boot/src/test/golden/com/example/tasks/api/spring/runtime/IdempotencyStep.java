package com.example.tasks.api.spring.runtime;

import io.github.jubasse.seampact.hooks.IdempotencyBegin;
import io.github.jubasse.seampact.hooks.IdempotencyClaim;
import io.github.jubasse.seampact.hooks.IdempotencyStore;
import io.github.jubasse.seampact.hooks.StoredResponse;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.MissingNode;
import tools.jackson.databind.node.ObjectNode;

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
    private static final String CONTENT_HEADER_PREFIX = "content-";
    private static final String REPLAYED = "true";
    private static final String AUTHORIZATION_HEADER = "authorization";
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
        String fingerprint = fingerprint(boundary.table().ir(), route.operation(), exchange.inputTree);

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

    /** The digest a retry under the same key must match: the method, the contract path and the decoded input. */
    static String fingerprint(JsonNode ir, JsonNode operation, JsonNode inputTree) {
        // The decoded input holds the decoded path params, so an equivalent encoding of the path is the same request.
        return Digests.hexOf(List.of(
                NODES.stringNode(operation.path("method").asString()),
                NODES.stringNode(operation.path("path").asString()),
                withoutHeaders(inputTree, credentialHeaders(ir, operation))));
    }

    // The headers carrying a credential, lower case: a retry after a token or session refresh is the same request
    // (ADR 0012 "Target obligations"), and a fingerprint never digests a credential.
    private static Set<String> credentialHeaders(JsonNode ir, JsonNode operation) {
        Set<String> names = new HashSet<>();
        JsonNode access = operation.path("access");
        for (JsonNode schemeId : access.path("schemes")) {
            JsonNode scheme = ir.path("schemes").path(schemeId.asString());
            switch (scheme.path("kind").asString()) {
                case "bearer" -> names.add(AUTHORIZATION_HEADER);
                case "header" -> names.add(scheme.path("name").asString().toLowerCase(Locale.ROOT));
                default -> { } // a cookie travels in no header param
            }
        }

        JsonNode identity = ir.path("identities").path(access.path("identity").asString());
        if (identity.has("signed")) names.add(ir.path("schemes").path(identity.path("signed").asString()).path("name").asString().toLowerCase(Locale.ROOT));
        if (operation.path("csrf").has("header")) names.add(operation.path("csrf").path("header").asString().toLowerCase(Locale.ROOT));

        return names;
    }

    // Header names are digested in lower case, as the Node targets key them.
    private static JsonNode withoutHeaders(JsonNode inputTree, Set<String> names) {
        if (!(inputTree instanceof ObjectNode input)) return inputTree;

        ObjectNode headers = NODES.objectNode();
        for (Map.Entry<String, JsonNode> header : input.path("headers").properties()) {
            String name = header.getKey().toLowerCase(Locale.ROOT);
            if (!names.contains(name)) headers.set(name, header.getValue());
        }

        ObjectNode digested = input.deepCopy();
        digested.set("headers", headers);

        return digested;
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
            else store.complete(key, new StoredResponse(response.heldStatus(), storedHeaders(exchange.route(), response), body));
        } catch (RuntimeException failure) {
            SeampactBoundary.LOG.error("seampact: the idempotency store failed to record the reply of {}.{}; a retry with the same key may run"
                    + " again. Check the store's backend.", boundary.apiId(), exchange.route().id(), failure);
        }
    }

    private static String principalDigest(SeampactBoundary boundary, BoundaryExchange exchange) {
        if (exchange.principal == null) return "";

        return Digests.hexOf(List.of(boundary.mapper().valueToTree(exchange.principal)));
    }

    // The contract reply only, as the Node targets store it: its content headers and the headers the operation declares
    // for its status. Headers the framework set beside it (session cookies, CORS, security headers) belong to the
    // request that ran and are never stored or replayed.
    private static List<StoredResponse.Header> storedHeaders(ContractRoute route, CheckingResponse response) {
        Set<String> declared = declaredHeaders(route, response.heldStatus());
        List<StoredResponse.Header> headers = new ArrayList<>();
        if (response.getContentType() != null) headers.add(new StoredResponse.Header(CONTENT_TYPE, response.getContentType()));
        for (String name : response.getHeaderNames()) {
            String lowerName = name.toLowerCase(Locale.ROOT);
            if (lowerName.equals(CONTENT_TYPE)) continue;
            if (!lowerName.startsWith(CONTENT_HEADER_PREFIX) && !declared.contains(lowerName)) continue;

            for (String value : response.getHeaders(name)) headers.add(new StoredResponse.Header(lowerName, value));
        }

        return headers;
    }

    private static Set<String> declaredHeaders(ContractRoute route, int status) {
        Set<String> declared = new HashSet<>();
        for (JsonNode response : route.operation().path("responses")) {
            if (response.path("status").asInt() != status) continue;
            for (JsonNode header : response.path("headers")) declared.add(header.path("name").asString().toLowerCase(Locale.ROOT));
        }

        return declared;
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
