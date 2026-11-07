package com.example.consumer;

import io.github.jubasse.seampact.hooks.ThrottleBucket;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/**
 * The sample app's side of the suite's control routes: the script a case loads, the hook calls the doubles record
 * and the log lines the app writes (ADR 0015 "The shared black-box HTTP suite").
 */
final class SuiteControl {
    private static final Set<String> SCRIPT_MEMBERS = Set.of("decisions", "scopes", "answers", "holds");
    private static final String HOLD_HOOK = "hold";
    // Below the suite's request timeout, so a hold the suite never releases still answers.
    private static final long HOLD_LIMIT_MS = 5000;
    private static final long HOLD_POLL_MS = 10;

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
        recordHookCall(hook, api, operation, Optional.empty());
    }

    /** Records a hook call, and the bucket a decide call received, its key digest left out. */
    static synchronized void recordHookCall(String hook, String api, String operation, Optional<ThrottleBucket> bucket) {
        if (!recording) return;

        ObjectNode call = JsonNodeFactory.instance.objectNode();
        call.put("hook", hook);
        call.put("operation", api + "." + operation);
        bucket.ifPresent(received -> call.set("bucket", recordedBucket(received)));
        HOOK_CALLS.add(call);
    }

    private static ObjectNode recordedBucket(ThrottleBucket bucket) {
        ObjectNode recorded = JsonNodeFactory.instance.objectNode();
        recorded.put("id", bucket.id());
        ArrayNode values = recorded.putArray("values");
        for (Object value : bucket.values()) values.add(keyValueNode(value));
        bucket.limit().ifPresent(limit -> recorded.put("limit", limit));
        bucket.windowMs().ifPresent(windowMs -> recorded.put("windowMs", windowMs));

        return recorded;
    }

    // A key value is a string, a number, a boolean or an id the generated principal types as a UUID.
    private static JsonNode keyValueNode(Object value) {
        return switch (value) {
            case String text -> JsonNodeFactory.instance.stringNode(text);
            case UUID id -> JsonNodeFactory.instance.stringNode(id.toString());
            case Long number -> JsonNodeFactory.instance.numberNode(number);
            case Integer number -> JsonNodeFactory.instance.numberNode(number);
            case Double number -> JsonNodeFactory.instance.numberNode(number);
            case Boolean flag -> JsonNodeFactory.instance.booleanNode(flag);
            default -> throw new IllegalStateException("the bucket key value " + value + " is not one the hook-calls route can answer as JSON");
        };
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

    /** Whether the script holds the operation's handler until a script that does not is loaded. */
    static synchronized boolean isHeld(String api, String operation) {
        for (JsonNode held : script.path("holds")) {
            if (held.asString().equals(api + "." + operation)) return true;
        }

        return false;
    }

    /** Records the hold, then waits until the operation is released or the hold limit has passed. */
    static void waitForRelease(String api, String operation) {
        recordHookCall(HOLD_HOOK, api, operation);

        long deadline = System.currentTimeMillis() + HOLD_LIMIT_MS;
        while (isHeld(api, operation) && System.currentTimeMillis() < deadline) {
            try {
                Thread.sleep(HOLD_POLL_MS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("the held handler of " + api + "." + operation + " was interrupted", interrupted);
            }
        }
    }
}
