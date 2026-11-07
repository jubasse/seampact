package io.github.jubasse.seampact.hooks;

/**
 * One per scope kind, called outermost scope first.
 *
 * @param <Request> the scope's generated request record
 * @param <Scope> the resolved scope
 * @param <Denial> the scope's declared membership codes
 */
public interface ResolveScopeHook<
        Request extends ResolveScopeRequest<?, ?, ?, ?>,
        Scope extends ResolvedScope<?, ?>,
        Denial extends ErrorCodeWithParams> {
    ScopeResolution<Scope, Denial> resolveScope(Request request);
}
