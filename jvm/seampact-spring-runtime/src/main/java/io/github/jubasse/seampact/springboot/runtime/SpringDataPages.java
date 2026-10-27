package io.github.jubasse.seampact.springboot.runtime;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import tools.jackson.databind.JsonNode;

/**
 * The Spring Data bridge of a `springPage` list (ADR 0022 "Paging"), loaded only by an api that has one: the
 * `Pageable` built from the query the boundary validated (its limit already filled), and the page facts read from the
 * `Page` the handler returned.
 */
public final class SpringDataPages {
    private static final String PAGE_ROLE = "page";
    private static final String LIMIT_ROLE = "limit";
    private static final String SORT_ROLE = "sort";
    private static final String PAIR_SEPARATOR = ",";
    private static final String DESCENDING = "desc";
    private static final long DEFAULT_PAGE_BASE = 1;

    private SpringDataPages() {}

    /**
     * The `Pageable` of the validated [query]: the zero-based page, the size and the sort pairs of [style], each key
     * replaced by the item's Java member [sortProperties] names, the property Spring Data sorts the entity by.
     */
    public static Pageable pageable(JsonNode style, JsonNode query, Map<String, String> sortProperties) {
        JsonNode pageRole = roleOf(style, PAGE_ROLE);
        long base = pageRole.path("base").asLong(DEFAULT_PAGE_BASE);
        // The boundary refused a page past the `int` range at its `maximum` (InputStep), so the index fits.
        long page = query.path(pageRole.path("name").asString()).asLong(base) - base;
        int size = query.path(roleOf(style, LIMIT_ROLE).path("name").asString()).asInt();

        return PageRequest.of(Math.toIntExact(page), size, sortOf(query.path(roleOf(style, SORT_ROLE).path("name").asString()), sortProperties));
    }

    /** The facts the boundary renders a page from (`items`, `total`) when [body] is a `Page`; any other body as is. */
    public static Object facts(Object body) {
        if (!(body instanceof Page<?> page)) return body;

        return Map.of("items", page.getContent(), "total", page.getTotalElements());
    }

    // Each validated pair is `key,asc` or `key,desc` (ADR 0002 section 14).
    private static Sort sortOf(JsonNode pairs, Map<String, String> sortProperties) {
        List<Sort.Order> orders = new ArrayList<>();
        for (JsonNode pair : pairs) {
            String[] keyAndDirection = pair.asString().split(PAIR_SEPARATOR, 2);
            String property = sortProperties.get(keyAndDirection[0]);
            if (property == null) {
                throw new IllegalStateException("seampact: the sort key '" + keyAndDirection[0] + "' has no Java member; regenerate the api");
            }

            boolean descending = DESCENDING.equals(keyAndDirection[1]);
            orders.add(descending ? Sort.Order.desc(property) : Sort.Order.asc(property));
        }

        return Sort.by(orders);
    }

    private static JsonNode roleOf(JsonNode style, String role) {
        for (JsonNode request : style.path("request")) {
            if (role.equals(request.path("role").asString())) return request;
        }

        throw new IllegalStateException("seampact: the springPage style has no '" + role + "' role");
    }
}
