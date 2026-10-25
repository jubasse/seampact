package io.github.jubasse.seampact.springboot.runtime;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.MissingNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The page a paged list answers (ADR 0002 section 14): the limit the handler receives, then the body, headers and
 * `Link` relations the paging style writes from the handler's facts and the request's position.
 */
final class PageReply {
    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;
    private static final String LIMIT_ROLE = "limit";
    private static final String BEFORE_ROLE = "before";
    private static final String AFTER_ROLE = "after";
    private static final String CLAMP = "clamp";
    private static final String NOT_RULE = "not";
    private static final String NULL_ABSENT = "null";
    private static final String PAGE = "page";
    private static final String OFFSET = "offset";
    private static final String SINCE = "since";
    private static final String CURSOR = "cursor";
    private static final int DEFAULT_PAGE_BASE = 1;
    private static final long FIRST_OFFSET = 0;

    private PageReply() {}

    /** A page body and the headers its style writes, names as declared. */
    record RenderedPage(JsonNode body, List<Map.Entry<String, String>> headers) {}

    /**
     * The limit the handler receives: the route's default when the client sent none, and the route's `maxLimit` for a
     * larger one under `overLimit: clamp` (a larger one under `reject` was refused by the structural pass).
     */
    static void fillLimit(ContractTable table, ContractRoute route, ObjectNode query) {
        JsonNode paging = route.operation().path("paging");
        JsonNode style = table.pagingStyle(route);
        String limitParam = roleName(style, LIMIT_ROLE);
        if (limitParam == null) return;

        JsonNode sent = query.path(limitParam);
        if (sent.isMissingNode()) {
            if (paging.path("defaultLimit").isNumber()) query.put(limitParam, paging.path("defaultLimit").asLong());
            return;
        }

        JsonNode maxLimit = paging.path("maxLimit");
        if (CLAMP.equals(paging.path("overLimit").asString()) && maxLimit.isNumber() && sent.isNumber() && sent.asLong() > maxLimit.asLong()) {
            query.put(limitParam, maxLimit.asLong());
        }
    }

    /**
     * A cursor style that carries `after` and `before` takes one of them: both sent is one `not` issue at the `before`
     * parameter, the JSON Schema form `not: {required: [after, before]}`.
     */
    static void checkOnePosition(ContractTable table, ContractRoute route, JsonNode query, List<InputIssue> issues) {
        JsonNode style = table.pagingStyle(route);
        String afterParam = roleName(style, AFTER_ROLE);
        String beforeParam = roleName(style, BEFORE_ROLE);
        if (afterParam == null || beforeParam == null) return;

        if (query.has(afterParam) && query.has(beforeParam)) issues.add(new InputIssue("query", InputIssue.below("", beforeParam), NOT_RULE));
    }

    /** The page of [handlerPage] (its facts; [items] already projected), rendered for [status]. */
    static RenderedPage render(ContractTable table, BoundaryExchange exchange, String rawQuery, String requestPath, Optional<String> publicOrigin, JsonNode handlerPage, JsonNode items, int status) {
        ContractRoute route = exchange.route();
        JsonNode style = table.pagingStyle(route);
        boolean writeNulls = NULL_ABSENT.equals(style.path("absent").asString());
        String query = rawQuery == null ? "" : rawQuery;

        ObjectNode slots = NODES.objectNode();
        for (JsonNode member : style.path("handlerResult")) {
            String name = member.asString();
            if (handlerPage.has(name)) slots.set(name, handlerPage.get(name));
        }

        JsonNode limit = limitOf(route, style, exchange.query);
        if (limit.isNumber()) slots.set(LIMIT_ROLE, limit);
        if (limit.isNumber() && handlerPage.path("total").isNumber() && limit.asLong() > 0) {
            slots.put("totalPages", ceilDivision(handlerPage.path("total").asLong(), limit.asLong()));
        }
        String urlBase = publicOrigin.map(origin -> origin + requestPath).orElse("");
        slots.put("self", pageUrl(urlBase, WireDecoding.withoutQueryMembers(query, List.of())));

        String position = style.path("position").asString();
        if (PAGE.equals(position) || OFFSET.equals(position)) {
            numberedSlots(route, style, exchange.query, query, urlBase, handlerPage, items.size(), limit, slots);
        } else {
            tokenSlots(style, query, urlBase, handlerPage, position, slots);
        }

        slots.set("items", items);
        slots.put("status", status);
        slots.put("path", requestPath);
        JsonNode meta = renderedMeta(style, slots, writeNulls);
        if (!meta.isMissingNode()) slots.set("meta", meta);

        return new RenderedPage(Templates.render(pageBody(table, route, style), slots, writeNulls), headers(style, slots));
    }

    // The style's own body, or the format's page body, whose `$meta` the style's meta joins.
    private static JsonNode pageBody(ContractTable table, ContractRoute route, JsonNode style) {
        JsonNode body = style.path("response").path("body");
        if (!body.isMissingNode()) return body;

        return table.format(route).path("success").path("page").path("body");
    }

    // The style's meta members, joined into the format's `$meta`; none leaves `$meta` without a value.
    private static JsonNode renderedMeta(JsonNode style, JsonNode slots, boolean writeNulls) {
        ObjectNode meta = NODES.objectNode();
        for (JsonNode member : style.path("response").path("meta")) {
            JsonNode value = Templates.render(member.path("value"), slots, writeNulls);
            if (!value.isMissingNode()) meta.set(member.path("name").asString(), value);
            else if (writeNulls) meta.putNull(member.path("name").asString());
        }

        return meta.isEmpty() ? MissingNode.getInstance() : meta;
    }

    private static List<Map.Entry<String, String>> headers(JsonNode style, JsonNode slots) {
        List<Map.Entry<String, String>> headers = new ArrayList<>();
        for (JsonNode header : style.path("response").path("headers")) {
            String value = Templates.text(Templates.render(header.path("value"), slots, false));
            if (value != null) headers.add(Map.entry(header.path("name").asString(), value));
        }

        List<String> relations = new ArrayList<>();
        for (JsonNode link : style.path("response").path("links")) {
            JsonNode url = slots.path(link.path("role").asString());
            if (url.isString()) relations.add("<" + url.asString() + ">; rel=\"" + link.path("rel").asString() + "\"");
        }
        if (!relations.isEmpty()) headers.add(Map.entry("Link", String.join(", ", relations)));

        return headers;
    }

    // A page or offset position: the boundary counts the page, its records and the URLs from the request.
    private static void numberedSlots(ContractRoute route, JsonNode style, JsonNode sentQuery, String query, String urlBase, JsonNode handlerPage, int itemCount, JsonNode limitNode, ObjectNode slots) {
        if (!limitNode.isNumber() || limitNode.asLong() <= 0) {
            throw new IllegalStateException("seampact: the list '" + route.id() + "' has no limit");
        }

        long limit = limitNode.asLong();
        boolean isPage = PAGE.equals(style.path("position").asString());
        JsonNode positionRole = positionRole(style);
        String positionParam = positionRole.path("name").asString();
        long base = positionRole.path("base").asLong(DEFAULT_PAGE_BASE);
        JsonNode sent = sentQuery == null ? MissingNode.getInstance() : sentQuery.path(positionParam);

        long offset;
        if (isPage) {
            long pageNumber = sent.isNumber() ? sent.asLong() : base;
            slots.put(PAGE, pageNumber);
            offset = (pageNumber - base) * limit;
        } else {
            offset = sent.isNumber() ? sent.asLong() : FIRST_OFFSET;
        }
        slots.put(OFFSET, offset);

        long pageIndex = Math.floorDiv(offset, limit);
        long nextOffset = offset + limit;
        boolean hasNext = hasMember(style, "more")
                ? handlerPage.path("more").asBoolean(false)
                : handlerPage.path("total").isNumber() && nextOffset < handlerPage.path("total").asLong();

        if (itemCount > 0) {
            slots.put("from", offset + 1);
            slots.put("to", offset + itemCount);
        }

        slots.put("first", pageUrl(urlBase, WireDecoding.withQueryMember(query, positionParam, positionAt(isPage, base, 0, limit))));
        if (offset > FIRST_OFFSET) {
            long previousOffset = Math.max(offset - limit, FIRST_OFFSET);
            String previous = isPage ? String.valueOf(base + Math.floorDiv(previousOffset, limit)) : String.valueOf(previousOffset);
            slots.put("previous", pageUrl(urlBase, WireDecoding.withQueryMember(query, positionParam, previous)));
        }
        if (hasNext) {
            // An offset the client chose need not fall on a page start: the next page starts one limit further.
            String next = isPage ? positionAt(true, base, pageIndex + 1, limit) : String.valueOf(nextOffset);
            slots.put("next", pageUrl(urlBase, WireDecoding.withQueryMember(query, positionParam, next)));
        }
        if (slots.path("totalPages").isNumber()) {
            long lastIndex = Math.max(slots.path("totalPages").asLong() - 1, 0);
            slots.put("last", pageUrl(urlBase, WireDecoding.withQueryMember(query, positionParam, positionAt(isPage, base, lastIndex, limit))));
        }
    }

    // A cursor or since position: the URLs carry the tokens the handler returned.
    private static void tokenSlots(JsonNode style, String query, String urlBase, JsonNode handlerPage, String position, ObjectNode slots) {
        String positionParam = positionRole(style).path("name").asString();
        String beforeParam = roleName(style, BEFORE_ROLE);
        List<String> positionParams = beforeParam == null ? List.of(positionParam) : List.of(positionParam, beforeParam);
        String withoutPosition = WireDecoding.withoutQueryMembers(query, positionParams);

        slots.put("first", pageUrl(urlBase, withoutPosition));
        if (SINCE.equals(position)) {
            putTokenUrl(slots, urlBase, "next", withoutPosition, positionParam, handlerPage.path("nextSince"));
            return;
        }

        putTokenUrl(slots, urlBase, "next", withoutPosition, positionParam, handlerPage.path("nextCursor"));
        putTokenUrl(slots, urlBase, "previous", withoutPosition, beforeParam == null ? positionParam : beforeParam, handlerPage.path("previousCursor"));
    }

    private static void putTokenUrl(ObjectNode slots, String urlBase, String role, String query, String param, JsonNode token) {
        if (token.isString()) slots.put(role, pageUrl(urlBase, WireDecoding.withQueryMember(query, param, token.asString())));
    }

    private static String positionAt(boolean isPage, long base, long index, long limit) {
        return String.valueOf(isPage ? base + index : index * limit);
    }

    // A cursor kind may carry its position in `after` and `before` instead of `cursor`.
    private static JsonNode positionRole(JsonNode style) {
        String position = style.path("position").asString();
        for (JsonNode role : style.path("request")) {
            if (role.path("role").asString().equals(position)) return role;
        }
        if (CURSOR.equals(position)) {
            for (JsonNode role : style.path("request")) {
                if (AFTER_ROLE.equals(role.path("role").asString())) return role;
            }
        }

        throw new IllegalStateException("seampact: the paging style '" + style.path("id").asString() + "' has no position role");
    }

    private static String roleName(JsonNode style, String roleName) {
        for (JsonNode role : style.path("request")) {
            if (roleName.equals(role.path("role").asString())) return role.path("name").asString();
        }

        return null;
    }

    private static JsonNode limitOf(ContractRoute route, JsonNode style, JsonNode sentQuery) {
        String limitParam = roleName(style, LIMIT_ROLE);
        if (limitParam == null) return route.operation().path("paging").path("defaultLimit");

        return sentQuery == null ? MissingNode.getInstance() : sentQuery.path(limitParam);
    }

    private static boolean hasMember(JsonNode style, String member) {
        for (JsonNode candidate : style.path("handlerResult")) {
            if (candidate.asString().equals(member)) return true;
        }

        return false;
    }

    private static long ceilDivision(long dividend, long divisor) {
        return Math.floorDiv(dividend + divisor - 1, divisor);
    }

    // Under relative URLs a query-only reference (RFC 3986): it resolves against the URL the client called, so it keeps
    // a path prefix a reverse proxy stripped. An empty query is `?`, since an empty reference would keep the called
    // query. Under absolute URLs the base is the public origin and the request path.
    private static String pageUrl(String urlBase, String query) {
        return urlBase + "?" + query;
    }
}
