package io.github.jubasse.seampact.springboot.runtime;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.MissingNode;

/**
 * The response headers the contract table derives (ADR 0004 section 7), which the generator lists per operation and
 * status in the settings' `responseHeaders`: a deprecated operation's Deprecation and Sunset texts and its successor
 * Link, and the strong entity tag of an item versioned by `If-Match` (grammar section 6). The other derived headers
 * are written by the steps that own them: the idempotency replay, `cache.etag` and the paging headers.
 */
final class ResponseHeaders {
    private static final String TEXT = "text";
    private static final String SUCCESSOR_LINK = "successorLink";
    private static final String ENTITY_TAG = "entityTag";
    private static final Pattern PATH_PARAM = Pattern.compile("\\{([^}]+)\\}");
    // RFC 9110 section 8.8.3 `etagc`: a version whose text holds another character makes no strong entity tag.
    private static final Pattern ENTITY_TAG_TEXT = Pattern.compile("^[\\x21\\x23-\\x7e]*$");
    // The integers every server reads exactly, as JavaScript's safe integers.
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;

    /** A header the reply writes: its name and value. */
    record Header(String name, String value) {}

    /** A response's derived headers: those of a success, and the entity tag, which a 304 keeps too. */
    record Derived(List<Header> successHeaders, Optional<Header> entityTag) {}

    /**
     * A derived header the reply cannot write, answered with the api's 500: the handler returned an item whose version
     * field no strong entity tag can carry, or the contract table lists a header this runtime does not know.
     */
    static final class UnwritableHeader extends Exception {
        private static final long serialVersionUID = 1L;

        UnwritableHeader(String reason) {
            super(reason, null, false, false);
        }
    }

    private ResponseHeaders() {}

    /** The derived headers of [exchange]'s [status] for the handler's body, before any field right removes a member. */
    static Derived of(ContractTable table, BoundaryExchange exchange, int status, JsonNode handlerBody) throws UnwritableHeader {
        ContractRoute route = exchange.route();
        JsonNode entries = table.settings().path("responseHeaders").path(route.id()).path(String.valueOf(status));
        List<Header> successHeaders = new ArrayList<>();
        Optional<Header> entityTag = Optional.empty();

        for (JsonNode entry : entries) {
            String name = entry.path("name").asString();
            String kind = entry.path("kind").asString();

            switch (kind) {
                case TEXT -> successHeaders.add(new Header(name, entry.path("value").asString()));
                case SUCCESSOR_LINK -> successHeaders.add(new Header(name, successorLink(table, route, entry, exchange.pathParams())));
                case ENTITY_TAG -> entityTag = Optional.of(new Header(name, versionEntityTag(route, entry.path("field").asString(), handlerBody)));
                default -> throw new UnwritableHeader("the contract table lists the response header '" + name + "' of '" + route.id()
                        + "' with the kind '" + kind + "', which this runtime does not write: generate the code again with the plugin of the runtime's version");
            }
        }

        return new Derived(List.copyOf(successHeaders), entityTag);
    }

    /**
     * RFC 8288: `<target>; rel="<rel>"`, the target the successor's path under the entry's mount with each param the
     * request's param of the same name, encoded as one path segment, so a value never breaks out of the link.
     */
    private static String successorLink(ContractTable table, ContractRoute route, JsonNode entry, Map<String, String> pathParams) {
        String path = entry.path("path").asString();
        Matcher param = PATH_PARAM.matcher(path);
        StringBuilder target = new StringBuilder(table.settings().path("mount").asString(""));

        while (param.find()) {
            String value = pathParams.get(param.group(1));
            if (value == null) {
                throw new IllegalStateException("seampact: the successor path '" + path + "' of '" + route.id() + "' names the param '" + param.group(1) + "', which the request has not");
            }
            param.appendReplacement(target, Matcher.quoteReplacement(WireDecoding.segmentEncoded(value)));
        }
        param.appendTail(target);

        return "<" + target + ">; rel=\"" + entry.path("rel").asString() + "\"";
    }

    // The item's version as a strong entity tag, `"7"`: the field's integer or text, as the client sends it back.
    private static String versionEntityTag(ContractRoute route, String field, JsonNode item) throws UnwritableHeader {
        JsonNode version = item.isObject() ? item.path(field) : MissingNode.getInstance();
        String text = versionText(version);

        if (text == null || !ENTITY_TAG_TEXT.matcher(text).matches()) {
            throw new UnwritableHeader("the handler of '" + route.id() + "' returned an item whose version field '" + field
                    + "' is no integer or entity tag text, so its ETag cannot be written");
        }

        return "\"" + text + "\"";
    }

    private static String versionText(JsonNode version) {
        if (version.isString()) return version.asString();

        boolean isSafeInteger = version.isIntegralNumber() && version.canConvertToLong() && Math.abs(version.longValue()) <= MAX_SAFE_INTEGER;

        return isSafeInteger ? String.valueOf(version.longValue()) : null;
    }
}
