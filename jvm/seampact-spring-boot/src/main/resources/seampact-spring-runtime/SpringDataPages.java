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
 * The Spring Data bridge of a `springPage` list (ADR 0022 "Paging"), copied only for an api that has one: the
 * `Pageable` built from the query the boundary validated (its limit already filled), and the page facts read from the
 * `Page` the handler returned.
 */
public final class SpringDataPages {
    private static final String PAGE_ROLE = "page";
    private static final String LIMIT_ROLE = "limit";
    private static final String SORT_ROLE = "sort";
    private static final String PAIR_SEPARATOR = ",";
    private static final String DESCENDING = "desc";

    private SpringDataPages() {}

    /** The `Pageable` of the validated [query]: the zero-based page, the size and the sort pairs of [style]. */
    public static Pageable pageable(JsonNode style, JsonNode query) {
        JsonNode pageRole = roleOf(style, PAGE_ROLE);
        long base = pageRole.path("base").asLong(0);
        long page = query.path(pageRole.path("name").asString()).asLong(base) - base;
        int size = query.path(roleOf(style, LIMIT_ROLE).path("name").asString()).asInt();

        return PageRequest.of(Math.toIntExact(page), size, sortOf(query.path(roleOf(style, SORT_ROLE).path("name").asString())));
    }

    /** The facts the boundary renders a page from (`items`, `total`) when [body] is a `Page`; any other body as is. */
    public static Object facts(Object body) {
        if (!(body instanceof Page<?> page)) return body;

        return Map.of("items", page.getContent(), "total", page.getTotalElements());
    }

    // Each validated pair is `key,asc` or `key,desc` (ADR 0002 section 14).
    private static Sort sortOf(JsonNode pairs) {
        List<Sort.Order> orders = new ArrayList<>();
        for (JsonNode pair : pairs) {
            String[] keyAndDirection = pair.asString().split(PAIR_SEPARATOR, 2);
            boolean descending = DESCENDING.equals(keyAndDirection[1]);
            orders.add(descending ? Sort.Order.desc(keyAndDirection[0]) : Sort.Order.asc(keyAndDirection[0]));
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
