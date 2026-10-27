package io.github.jubasse.seampact.springboot.runtime;

import java.util.Objects;
import tools.jackson.databind.JsonNode;

/** A refusal a boundary step answers with: one of the operation's codes and its params, written in the api's format. */
final class ContractRefusal extends RuntimeException {
    private static final long serialVersionUID = 1L;

    private final String code;
    private final transient JsonNode params;

    ContractRefusal(String code, JsonNode params) {
        super(code, null, false, false);
        this.code = Objects.requireNonNull(code, "code");
        this.params = params;
    }

    String code() {
        return code;
    }

    JsonNode params() {
        return params;
    }
}
