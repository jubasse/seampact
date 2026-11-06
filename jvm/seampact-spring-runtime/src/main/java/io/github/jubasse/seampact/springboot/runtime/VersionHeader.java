package io.github.jubasse.seampact.springboot.runtime;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Collections;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.MissingNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The version a write sends in a request header (grammar section 6), read before the input is validated: a missing or
 * empty one answers the `preconditionRequired` role (428), never `schemaInvalid`. `If-Match` carries it as one entity
 * tag, strong or weak (a compressing server or proxy weakens the tag it read, and the version is the same): `*` names
 * no version and is missing too, and a list or a value that is no tag can match no version, so it answers the
 * `preconditionFailed` role (412). The handler receives the version unquoted and compares it with the stored one.
 */
final class VersionHeader {
    private static final String HEADER_SOURCE = "header";
    private static final String IF_MATCH = "If-Match";
    private static final String PRECONDITION_REQUIRED_ROLE = "preconditionRequired";
    private static final String PRECONDITION_FAILED_ROLE = "preconditionFailed";
    private static final String ANY_ENTITY_TAG = "*";
    private static final Pattern ENTITY_TAG = Pattern.compile("^(?:W/)?\"([^\"]*)\"$");

    private VersionHeader() {}

    /**
     * The version an `If-Match` tag carries, empty for another header source or none; throws the operation's 428 or 412
     * refusal when the version header is missing or can match no version.
     */
    static Optional<String> sentVersion(ContractRoute route, HttpServletRequest request) {
        JsonNode version = route.operation().path("concurrency").path("version");
        if (!HEADER_SOURCE.equals(version.path("in").asString())) return Optional.empty();

        String name = version.path("name").asString(null);
        if (name == null) throw new IllegalStateException("seampact: the header version of '" + route.id() + "' has no header name");

        String sent = String.join(", ", Collections.list(request.getHeaders(name))).trim();
        if (sent.isEmpty()) throw refusal(route, PRECONDITION_REQUIRED_ROLE);

        if (!IF_MATCH.equalsIgnoreCase(name)) return Optional.empty();

        if (sent.equals(ANY_ENTITY_TAG)) throw refusal(route, PRECONDITION_REQUIRED_ROLE);

        Matcher tag = ENTITY_TAG.matcher(sent);
        if (!tag.matches()) throw refusal(route, PRECONDITION_FAILED_ROLE);

        return Optional.of(tag.group(1));
    }

    /** Replaces the tag in the validated [headers] with the unquoted [version], so `"7"` and `W/"7"` both hand over `7`. */
    static void handOver(ContractRoute route, ObjectNode headers, String version) {
        String name = route.operation().path("concurrency").path("version").path("name").asString();

        for (String param : headers.propertyNames()) {
            if (param.equalsIgnoreCase(name)) {
                headers.put(param, version);
                return;
            }
        }

        throw new IllegalStateException("seampact: the validated headers of '" + route.id() + "' have no '" + name + "' to hand its version in");
    }

    private static ContractRefusal refusal(ContractRoute route, String role) {
        return new ContractRefusal(BoundaryFilter.roleCode(route, role), MissingNode.getInstance());
    }
}
