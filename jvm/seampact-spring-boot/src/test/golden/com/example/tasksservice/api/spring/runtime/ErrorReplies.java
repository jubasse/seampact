package com.example.tasksservice.api.spring.runtime;

import java.util.Map;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
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

        JsonNode bodyTemplate = format.path("error").path("body");
        JsonNode rendered = render(bodyTemplate, slots, writeNulls);
        if (rendered instanceof ObjectNode body
                && MERGE_PARAMS.equals(bodyTemplate.path("merge").asString())
                && params instanceof ObjectNode paramMembers) {
            paramMembers.properties().forEach(member -> body.set(member.getKey(), member.getValue()));
        }

        return rendered;
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

        return render(template, slotNode, false);
    }

    private static JsonNode render(JsonNode template, JsonNode slots, boolean writeNulls) {
        return switch (template.path("kind").asString()) {
            case "object" -> renderObject(template, slots, writeNulls);
            case "slot" -> slotValue(template, slots);
            case "text" -> NODES.stringNode(template.path("text").asString());
            case "literal" -> template.path("value");
            case "each" -> renderEach(template, slots, writeNulls);
            default -> throw new IllegalStateException(
                    "seampact: the format template kind '" + template.path("kind").asString() + "' is not one the boundary renders");
        };
    }

    private static JsonNode renderObject(JsonNode template, JsonNode slots, boolean writeNulls) {
        ObjectNode object = NODES.objectNode();
        for (JsonNode member : template.path("members")) {
            JsonNode value = render(member.path("value"), slots, writeNulls);
            String name = member.path("name").path("text").asString();
            if (!value.isMissingNode()) object.set(name, value);
            else if (writeNulls) object.putNull(name);
        }

        return object;
    }

    private static JsonNode renderEach(JsonNode template, JsonNode slots, boolean writeNulls) {
        ArrayNode items = NODES.arrayNode();
        for (JsonNode item : slots.path(template.path("of").asString())) {
            JsonNode itemSlots = slots.deepCopy();
            if (itemSlots instanceof ObjectNode withItem) withItem.set("item", item);
            items.add(render(template.path("as"), itemSlots, writeNulls));
        }

        return items;
    }

    private static JsonNode slotValue(JsonNode template, JsonNode slots) {
        JsonNode value = slots.path(template.path("slot").asString());
        for (JsonNode key : template.path("path")) value = value.path(key.asString());

        return value;
    }
}
