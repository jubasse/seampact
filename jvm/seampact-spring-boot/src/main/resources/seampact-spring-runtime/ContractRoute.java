package io.github.jubasse.seampact.springboot.runtime;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.MissingNode;

/** One contract operation as the boundary serves it: its method, its path template and its declared replies. */
public final class ContractRoute {
    private static final String PLACEHOLDER_START = "{";
    private static final String PLACEHOLDER_END = "}";
    private static final String PATH_PARAMETER_START = ";";

    /**
     * Spring's specificity between two templates of one length: at the first segment where one is literal and the
     * other a placeholder, the literal one first, whatever the IR order.
     */
    static final Comparator<ContractRoute> MOST_SPECIFIC_FIRST = ContractRoute::compareSpecificity;

    private final JsonNode operation;
    private final JsonNode errorCatalog;
    private final String[] templateSegments;
    private final String basePath;

    ContractRoute(JsonNode operation, JsonNode errorCatalog, String basePath) {
        this.operation = operation;
        this.errorCatalog = errorCatalog;
        this.templateSegments = operation.path("path").asString().split("/", -1);
        this.basePath = basePath;
    }

    public String id() {
        return operation.path("id").asString();
    }

    /** The HTTP method in upper case. */
    public String method() {
        return operation.path("method").asString().toUpperCase(Locale.ROOT);
    }

    public JsonNode operation() {
        return operation;
    }

    String basePath() {
        return basePath;
    }

    /** The decoded path parameters when [rawPath] matches the template exactly, segment by segment. */
    Optional<Map<String, String>> match(String rawPath) {
        String[] segments = rawPath.split("/", -1);
        if (segments.length != templateSegments.length) return Optional.empty();

        Map<String, String> params = new LinkedHashMap<>();
        for (int index = 0; index < segments.length; index++) {
            String template = templateSegments[index];
            String segment = segments[index];

            if (isPlaceholder(index)) {
                if (segment.isEmpty() || segment.contains(PATH_PARAMETER_START)) return Optional.empty();
                params.put(template.substring(1, template.length() - 1), decodedSegment(segment));
            } else if (!template.equals(segment)) {
                return Optional.empty();
            }
        }

        return Optional.of(params);
    }

    private boolean isPlaceholder(int index) {
        String template = templateSegments[index];

        return template.startsWith(PLACEHOLDER_START) && template.endsWith(PLACEHOLDER_END);
    }

    private static int compareSpecificity(ContractRoute first, ContractRoute second) {
        int shared = Math.min(first.templateSegments.length, second.templateSegments.length);

        for (int index = 0; index < shared; index++) {
            int order = Boolean.compare(first.isPlaceholder(index), second.isPlaceholder(index));
            if (order != 0) return order;
        }

        return Integer.compare(first.templateSegments.length, second.templateSegments.length);
    }

    // A path segment is percent-decoded as UTF-8; '+' stays a plus, unlike in a query.
    static String decodedSegment(String segment) {
        return URLDecoder.decode(segment.replace("+", "%2B"), StandardCharsets.UTF_8);
    }

    /** The code the operation answers for [role]: one listing the role, or one whose catalog default it is. */
    public Optional<String> codeOfRole(String role) {
        for (JsonNode error : operation.path("errors")) {
            for (JsonNode listed : error.path("roles")) {
                if (role.equals(listed.path("role").asString())) return Optional.of(error.path("code").asString());
            }
        }
        for (JsonNode error : operation.path("errors")) {
            String code = error.path("code").asString();
            if (role.equals(errorCatalog.path(code).path("default").asString())) return Optional.of(code);
        }

        return Optional.empty();
    }

    /** The first code the operation lists with [status]. */
    public Optional<String> codeOfStatus(int status) {
        for (JsonNode error : operation.path("errors")) {
            String code = error.path("code").asString();
            if (statusOfCatalog(code) == status) return Optional.of(code);
        }

        return Optional.empty();
    }

    /** The status of [code] when the operation lists it. */
    public OptionalInt statusOf(String code) {
        for (JsonNode error : operation.path("errors")) {
            if (code.equals(error.path("code").asString())) return OptionalInt.of(statusOfCatalog(code));
        }

        return OptionalInt.empty();
    }

    /** The retry header the operation gives [code], a missing node when it gives none. */
    JsonNode retryHeader(String code) {
        for (JsonNode error : operation.path("errors")) {
            if (code.equals(error.path("code").asString())) return error.path("retryHeader");
        }

        return MissingNode.getInstance();
    }

    /** The params template the operation gives [code] under [role], a missing node when it gives none. */
    JsonNode roleParams(String code, String role) {
        for (JsonNode error : operation.path("errors")) {
            if (!code.equals(error.path("code").asString())) continue;
            for (JsonNode listed : error.path("roles")) {
                if (role.equals(listed.path("role").asString())) return listed.path("params");
            }
        }

        return MissingNode.getInstance();
    }

    JsonNode catalogEntry(String code) {
        return errorCatalog.path(code);
    }

    /** The declared success reply of [status], a missing node when the operation declares none. */
    public JsonNode response(int status) {
        for (JsonNode response : operation.path("responses")) {
            if (response.path("status").asInt() == status) return response;
        }

        return MissingNode.getInstance();
    }

    /** Whether [status] is a declared success or the status of a listed code. */
    boolean declaresStatus(int status) {
        return !response(status).isMissingNode() || codeOfStatus(status).isPresent();
    }

    private int statusOfCatalog(String code) {
        return errorCatalog.path(code).path("http").path("status").asInt();
    }
}
