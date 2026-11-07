package io.github.jubasse.seampact.springboot.runtime;

import io.github.jubasse.seampact.hooks.ResolveScopeRequest;
import io.github.jubasse.seampact.hooks.ResolvedScope;
import io.github.jubasse.seampact.hooks.ScopeIdSource;
import java.util.List;
import java.util.Map;

/** One resolve-scope call: the scope, its id as the request declared it, the principal and the scopes around it. */
public record ScopeCall(
        String scope,
        ScopeIdSource<Object> source,
        Object principal,
        List<ResolvedScope<?, ?>> outerScopes,
        ResolveScopeRequest.Extensions<Map<String, Object>, Map<String, Object>> extensions)
        implements ResolveScopeRequest<Object, Object, Map<String, Object>, Map<String, Object>> {}
