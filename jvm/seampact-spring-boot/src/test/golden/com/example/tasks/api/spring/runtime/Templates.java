package com.example.tasks.api.spring.runtime;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.MissingNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Renders an IR template (ADR 0004 section 8) over its slots: the format's error and page bodies, a paging style's
 * meta members and headers. A slot with no value renders as missing; an object member that renders as missing is left
 * out, or written as `null` when the format or style says `absent: null`.
 */
final class Templates {
    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;
    private static final String ITEM_SLOT = "item";

    private Templates() {}

    static JsonNode render(JsonNode template, JsonNode slots, boolean writeNulls) {
        return switch (template.path("kind").asString()) {
            case "object" -> renderObject(template, slots, writeNulls);
            case "array" -> renderArray(template, slots, writeNulls);
            case "slot" -> slotValue(template, slots);
            case "text" -> renderText(template, slots);
            case "literal" -> template.path("value");
            case "each" -> renderEach(template, slots, writeNulls);
            default -> throw new IllegalStateException(
                    "seampact: the template kind '" + template.path("kind").asString() + "' is not one the boundary renders");
        };
    }

    /** A rendered value as header or link text, null when it is missing or `null`. */
    static String text(JsonNode value) {
        if (value.isMissingNode() || value.isNull()) return null;
        if (value.isContainer()) throw new IllegalStateException("seampact: a header template rendered an object or an array");

        return value.asString();
    }

    private static JsonNode renderObject(JsonNode template, JsonNode slots, boolean writeNulls) {
        ObjectNode object = NODES.objectNode();
        for (JsonNode member : template.path("members")) {
            JsonNode value = render(member.path("value"), slots, writeNulls);
            String name = memberName(member.path("name"), slots);
            if (name == null) continue;
            if (!value.isMissingNode()) object.set(name, value);
            else if (writeNulls) object.putNull(name);
        }

        if (template.path("merge").isString() && slots.path(template.path("merge").asString()) instanceof ObjectNode merged) {
            merged.properties().forEach(member -> object.set(member.getKey(), member.getValue()));
        }

        return object.isEmpty() ? MissingNode.getInstance() : object;
    }

    private static String memberName(JsonNode name, JsonNode slots) {
        if ("text".equals(name.path("kind").asString())) return name.path("text").asString();

        return text(slots.path(name.path("slot").asString()));
    }

    private static JsonNode renderArray(JsonNode template, JsonNode slots, boolean writeNulls) {
        ArrayNode items = NODES.arrayNode();
        for (JsonNode item : template.path("items")) {
            JsonNode value = render(item, slots, writeNulls);
            if (!value.isMissingNode()) items.add(value);
        }

        return items;
    }

    private static JsonNode renderEach(JsonNode template, JsonNode slots, boolean writeNulls) {
        JsonNode source = slots.path(template.path("of").asString());
        if (!source.isArray()) return MissingNode.getInstance();

        ArrayNode items = NODES.arrayNode();
        for (JsonNode item : source) {
            ObjectNode itemSlots = slots.isObject() ? ((ObjectNode) slots).deepCopy() : NODES.objectNode();
            itemSlots.set(ITEM_SLOT, item);
            JsonNode value = render(template.path("as"), itemSlots, writeNulls);
            if (!value.isMissingNode()) items.add(value);
        }

        return items;
    }

    private static JsonNode renderText(JsonNode template, JsonNode slots) {
        StringBuilder text = new StringBuilder();
        for (JsonNode part : template.path("parts")) {
            if ("text".equals(part.path("kind").asString())) {
                text.append(part.path("text").asString());
                continue;
            }

            String value = text(slotValue(part, slots));
            if (value == null) return MissingNode.getInstance();
            text.append(value);
        }

        return NODES.stringNode(text.toString());
    }

    private static JsonNode slotValue(JsonNode template, JsonNode slots) {
        JsonNode value = slots.path(template.path("slot").asString());
        for (JsonNode key : template.path("path")) value = value.path(key.asString());

        return value;
    }
}
