package com.example.tasksservice.api.spring.runtime;

import io.github.jubasse.seampact.hooks.ResolvedScope;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import tools.jackson.databind.JsonNode;

/**
 * One contract request as the boundary's pieces share it through a request attribute: the matched route, the held
 * body and response, what the steps resolved, and the marks of who wrote the reply (ADR 0022 "A reply the boundary
 * did not author").
 */
final class BoundaryExchange {
    final ContractTable.RouteMatch match;
    final String contractPath;
    final CheckingResponse response;
    final List<ResolvedScope<?, ?>> scopes = new ArrayList<>();

    byte[] body;
    Object principal;
    Object input;
    /** The decoded query step 6 bound, with the paging limit the handler receives. */
    JsonNode query;
    /** The decoded path, query, headers and body of step 6, which the idempotency fingerprint digests. */
    JsonNode inputTree;
    /** The idempotency key this request claimed, until its record is completed or abandoned. */
    String idempotencyKey;
    boolean admitted;
    boolean boundaryWrote;
    boolean exceptionSeen;
    Optional<String> violation = Optional.empty();

    BoundaryExchange(ContractTable.RouteMatch match, String contractPath, CheckingResponse response) {
        this.match = match;
        this.contractPath = contractPath;
        this.response = response;
    }

    /** Marks the reply as the boundary's own and keeps what it wrote, so a later change is a violation. */
    void markBoundaryWrote() {
        boundaryWrote = true;
        response.keepBoundaryReply();
    }

    ContractRoute route() {
        return match.route();
    }

    Map<String, String> pathParams() {
        return match.pathParams();
    }
}
