package com.example.optins.api.spring.runtime;

import java.util.Map;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/**
 * Renders a contract error in the api's format: the format's body template with the code's slots (`code`,
 * `status`, `title`, `nature`), and the params merged as the format says.
 */
final class ErrorReplies {
    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;
    private static final String MERGE_PARAMS = "params";
    private static final String NULL_ABSENT = "null";

    private ErrorReplies() {}

    /** The error body of [code] on [route]'s format, with [params] (a missing node when the code has none). */
    static JsonNode body(ContractTable table, ContractRoute route, String code, JsonNode params) {
        JsonNode format = table.format(route);
        JsonNode catalog = route.catalogEntry(code);
        boolean writeNulls = NULL_ABSENT.equals(format.path("absent").asString());

        ObjectNode slots = NODES.objectNode();
        slots.put("code", code);
        slots.put("status", catalog.path("http").path("status").asInt());
        slots.put("nature", catalog.path("nature").asString());
        if (catalog.path("title").isString()) slots.put("title", catalog.path("title").asString());

        if (params instanceof ObjectNode) slots.set(MERGE_PARAMS, params);

        JsonNode rendered = Templates.render(format.path("error").path("body"), slots, writeNulls);

        return rendered.isMissingNode() ? NODES.objectNode() : rendered;
    }

    /** The media type of the api's errors on [route]. */
    static String media(ContractTable table, ContractRoute route) {
        return table.format(route).path("error").path("media").asString();
    }

    /** The params of a role's template, filled from [slots] (`issues`, `limitBytes`). */
    static JsonNode roleParams(JsonNode template, Map<String, JsonNode> slots) {
        if (template.isMissingNode()) return template;

        ObjectNode slotNode = NODES.objectNode();
        slots.forEach(slotNode::set);

        return Templates.render(template, slotNode, false);
    }
}
