package io.github.jubasse.seampact.springboot.runtime;

import io.github.jubasse.seampact.hooks.RequirementKind;
import java.util.Optional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;

/** The params a decide request carries: the use site's values as the right's or rule's generated params record. */
final class RequirementParams {
    private RequirementParams() {}

    /** Empty for a right or rule that declares no params; `useSite` is the requirement or field right of the IR. */
    static Optional<Object> of(SeampactBoundary boundary, RequirementKind kind, String name, JsonNode useSite) {
        ApiBinding binding = boundary.binding();
        Class<?> paramsType = (kind == RequirementKind.RULE ? binding.ruleParamsTypes() : binding.rightParamsTypes()).get(name);
        if (paramsType == null) return Optional.empty();

        JsonNode values = useSite.has("params") ? useSite.path("params") : JsonNodeFactory.instance.objectNode();

        return Optional.of(boundary.mapper().treeToValue(values, paramsType));
    }
}
