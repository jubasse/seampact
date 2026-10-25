package io.github.jubasse.seampact.springboot.runtime;

import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.List;
import tools.jackson.databind.JsonNode;

/**
 * The cache headers of a success the boundary writes (ADR 0012 step 10): `Cache-Control` by caller kind, `Vary`, and
 * the strong ETag over the body bytes, with its 304 when `If-None-Match` names it. The ETag is the SHA-256 base64url of
 * the body as on the Node targets, so a client's tag stays valid across them.
 */
final class CacheHeaders {
    private static final String NO_STORE_DIRECTIVE = "no-store";
    private static final String CACHE_CONTROL_HEADER = "Cache-Control";
    private static final String ETAG_HEADER = "ETag";
    private static final String IF_NONE_MATCH_HEADER = "If-None-Match";
    private static final String WEAK_ETAG_PREFIX = "W/";
    private static final String ANY_TAG = "*";
    private static final String ANONYMOUS = "anonymous";
    private static final String IDENTIFIED = "identified";
    static final int NOT_MODIFIED = 304;

    private CacheHeaders() {}

    /** Writes the cache headers of [body]; true when the reply is the ETag's 304, which has no body. */
    static boolean write(BoundaryExchange exchange, HttpServletRequest request, CheckingResponse response, byte[] body) {
        JsonNode cache = exchange.route().operation().path("cache");
        if (!cache.isObject()) return false;

        String cacheControl = cache.path("noStore").asBoolean(false) ? NO_STORE_DIRECTIVE : cacheControlOf(cache, exchange.principal == null ? ANONYMOUS : IDENTIFIED);
        if (cacheControl != null) response.setHeader(CACHE_CONTROL_HEADER, cacheControl);

        List<String> vary = new ArrayList<>();
        cache.path("vary").forEach(name -> vary.add(name.asString()));
        if (!vary.isEmpty()) response.setHeader("Vary", String.join(", ", vary));

        if (!cache.path("etag").asBoolean(false)) return false;

        String etag = "\"" + Digests.base64UrlOf(body) + "\"";
        response.setBoundaryHeader(ETAG_HEADER, etag);

        return ifNoneMatchHolds(request.getHeader(IF_NONE_MATCH_HEADER), etag);
    }

    private static String cacheControlOf(JsonNode cache, String callerKind) {
        for (JsonNode entry : cache.path("perCallerKind")) {
            if (callerKind.equals(entry.path("caller").asString())) return entry.path("cacheControl").asString();
        }

        return null;
    }

    private static boolean ifNoneMatchHolds(String ifNoneMatch, String etag) {
        if (ifNoneMatch == null) return false;

        for (String tag : ifNoneMatch.split(",")) {
            String trimmed = tag.trim();
            if (trimmed.equals(ANY_TAG) || trimmed.equals(etag) || trimmed.equals(WEAK_ETAG_PREFIX + etag)) return true;
        }

        return false;
    }
}
