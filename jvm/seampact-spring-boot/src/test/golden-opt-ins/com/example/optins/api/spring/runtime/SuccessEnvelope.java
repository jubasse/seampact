package com.example.optins.api.spring.runtime;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/**
 * The success body of an item, table or list in its format's envelope (ADR 0002 section 13): `{ data: $payload }`
 * under `pack:laravel`, the payload itself under a bare format. Generation refuses an envelope that does not write
 * `$payload` under named members, so an object envelope always renders.
 */
final class SuccessEnvelope {
    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;
    private static final String PAYLOAD_SLOT = "payload";
    private static final String NULL_ABSENT = "null";

    private SuccessEnvelope() {}

    /** The body of [payload] in [format]'s [shape] envelope, with the reply's [status] and the request [path]. */
    static JsonNode body(JsonNode format, String shape, JsonNode payload, int status, String path) {
        JsonNode template = format.path("success").path(shape).path("body");
        if (template.isMissingNode() || isBarePayload(template)) return payload;

        ObjectNode slots = NODES.objectNode();
        slots.set(PAYLOAD_SLOT, payload);
        slots.put("status", status);
        slots.put("path", path);
        JsonNode rendered = Templates.render(template, slots, NULL_ABSENT.equals(format.path("absent").asString()));
        if (rendered.isMissingNode()) {
            throw new IllegalStateException("seampact: the format's '" + shape + "' success envelope rendered nothing; regenerate the api, whose generation refuses an envelope that does not write $payload under named members");
        }

        return rendered;
    }

    private static boolean isBarePayload(JsonNode template) {
        return "slot".equals(template.path("kind").asString())
                && PAYLOAD_SLOT.equals(template.path("slot").asString())
                && template.path("path").isEmpty();
    }
}
