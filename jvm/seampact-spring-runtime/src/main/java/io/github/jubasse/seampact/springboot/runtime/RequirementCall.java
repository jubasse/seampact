package io.github.jubasse.seampact.springboot.runtime;

import io.github.jubasse.seampact.hooks.OperationRef;
import io.github.jubasse.seampact.hooks.Purpose;
import io.github.jubasse.seampact.hooks.RequestView;
import io.github.jubasse.seampact.hooks.RequirementKind;
import io.github.jubasse.seampact.hooks.RequirementRequest;
import io.github.jubasse.seampact.hooks.ResolvedScope;
import io.github.jubasse.seampact.hooks.SubjectRef;
import io.github.jubasse.seampact.hooks.ThrottleBucket;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import tools.jackson.databind.JsonNode;

/** One decide call: the right or rule, its params as the contract writes them, and what the boundary resolved. */
public record RequirementCall(
        RequirementKind kind,
        String name,
        Optional<JsonNode> params,
        Object principal,
        Optional<SubjectRef<Object, Object>> subject,
        List<ResolvedScope<?, ?>> scopes,
        Optional<Object> proof,
        Optional<ThrottleBucket> bucket,
        Purpose purpose,
        OperationRef operation,
        RequestView request,
        RequirementRequest.Extensions<Map<String, Object>, Map<String, Object>> extensions)
        implements RequirementRequest<Denial, JsonNode, Object, Map<String, Object>, Map<String, Object>> {}
