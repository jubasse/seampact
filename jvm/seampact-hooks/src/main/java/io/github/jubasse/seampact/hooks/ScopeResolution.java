package io.github.jubasse.seampact.hooks;

import java.util.Objects;

/**
 * The resolved scope, or one of the scope's declared membership denials: exactly one of the two.
 *
 * @param <Scope> the resolved scope
 * @param <Denial> the scope's declared membership codes
 */
public sealed interface ScopeResolution<Scope extends ResolvedScope<?, ?>, Denial extends ErrorCodeWithParams>
        permits ScopeResolution.Resolved, ScopeResolution.Denied {
    /**
     * The scope is resolved.
     *
     * @param resolved the resolved scope
     */
    record Resolved<Scope extends ResolvedScope<?, ?>, Denial extends ErrorCodeWithParams>(Scope resolved)
            implements ScopeResolution<Scope, Denial> {
        public Resolved {
            Objects.requireNonNull(resolved, "resolved");
        }
    }

    /**
     * The caller is not a member of the scope.
     *
     * @param deny one of the scope's declared membership codes
     */
    record Denied<Scope extends ResolvedScope<?, ?>, Denial extends ErrorCodeWithParams>(Denial deny)
            implements ScopeResolution<Scope, Denial> {
        public Denied {
            Objects.requireNonNull(deny, "deny");
        }
    }
}
