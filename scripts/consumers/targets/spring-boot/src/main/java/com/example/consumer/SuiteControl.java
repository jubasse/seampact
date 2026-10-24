package com.example.consumer;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/**
 * The sample app's side of the suite's control routes: the script a case loads, the hook calls the doubles record
 * and the log lines the app writes (ADR 0015 "The shared black-box HTTP suite").
 */
final class SuiteControl {
    private static final Set<String> SCRIPT_MEMBERS = Set.of("decisions", "scopes", "answers");

    private static JsonNode script = JsonNodeFactory.instance.objectNode();
    private static boolean recording;
    private static final List<JsonNode> HOOK_CALLS = new ArrayList<>();
    private static final List<String> LOG_LINES = new ArrayList<>();

    private SuiteControl() {}

    /** Loads [body] as the script, or names why it is not one. */
    static synchronized Optional<String> load(JsonNode body) {
        if (!body.isObject()) return Optional.of("the script is not a JSON object");
        for (String member : body.propertyNames()) {
            if (!SCRIPT_MEMBERS.contains(member)) return Optional.of("the script member '" + member + "' is not one of " + SCRIPT_MEMBERS);
        }

        script = body;
        recording = true;
        HOOK_CALLS.clear();
        LOG_LINES.clear();

        return Optional.empty();
    }

    static synchronized List<JsonNode> hookCalls() {
        return List.copyOf(HOOK_CALLS);
    }

    static synchronized List<String> logLines() {
        return List.copyOf(LOG_LINES);
    }

    static synchronized void recordHookCall(String hook, String api, String operation) {
        if (!recording) return;

        ObjectNode call = JsonNodeFactory.instance.objectNode();
        call.put("hook", hook);
        call.put("operation", api + "." + operation);
        HOOK_CALLS.add(call);
    }

    static synchronized void writeLogLine(String line) {
        LOG_LINES.add(line);
    }

    /** The denial code the script gives a decide call of [name] for [purpose] (`route`, `field`, `sortKey`). */
    static synchronized Optional<String> scriptedDecision(String name, String purpose) {
        for (JsonNode decision : script.path("decisions")) {
            boolean purposeMatches = !decision.has("purpose") || decision.path("purpose").asString().equals(purpose);
            if (decision.path("name").asString().equals(name) && purposeMatches) return Optional.of(decision.path("deny").path("code").asString());
        }

        return Optional.empty();
    }

    static synchronized Optional<String> scriptedScopeDenial(String scope) {
        JsonNode denial = script.path("scopes").path(scope).path("deny");

        return denial.isMissingNode() ? Optional.empty() : Optional.of(denial.path("code").asString());
    }

    /** The answer the script gives an operation's handler in place of its own. */
    static synchronized Optional<JsonNode> scriptedAnswer(String api, String operation) {
        JsonNode answer = script.path("answers").path(api + "." + operation);

        return answer.isMissingNode() ? Optional.empty() : Optional.of(answer);
    }
}
