package com.example.consumer;

import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * What a handler answers in place of its own result when the loaded script says so: its declared success with the
 * script's body bound by the app's own mapper, one of its declared error arms, a thrown exception, or, for a status
 * or code the result type cannot hold, a reply the app writes itself, which the boundary's outgoing check judges.
 */
@Component
final class ScriptedAnswers {
    private final JsonMapper appMapper;

    ScriptedAnswers(JsonMapper appMapper) {
        this.appMapper = appMapper;
    }

    <Body, Result> Optional<Result> answer(
            String api, String operation, int successStatus, Class<Body> bodyType, Function<Body, Result> success,
            Map<String, Supplier<Result>> errorArms) {
        Optional<JsonNode> scripted = SuiteControl.scriptedAnswer(api, operation);
        if (scripted.isEmpty()) return Optional.empty();

        JsonNode answer = scripted.get();
        if (answer.has("throws")) throw new IllegalStateException(answer.path("throws").asString());

        int status = answer.path("status").asInt();
        String code = answer.path("code").asString("");
        if (!code.isEmpty() && errorArms.containsKey(code)) return Optional.of(errorArms.get(code).get());
        if (code.isEmpty() && status == successStatus) return Optional.of(success.apply(appMapper.treeToValue(answer.path("body"), bodyType)));

        throw new ScriptedReply(status, code, answer.path("body"));
    }

    /** A reply the result type cannot hold, written by the app's own advice. */
    static final class ScriptedReply extends RuntimeException {
        private static final long serialVersionUID = 1L;

        final int status;
        final String code;
        final transient JsonNode body;

        ScriptedReply(int status, String code, JsonNode body) {
            super("scripted reply " + status, null, false, false);
            this.status = status;
            this.code = code;
            this.body = body;
        }
    }
}
