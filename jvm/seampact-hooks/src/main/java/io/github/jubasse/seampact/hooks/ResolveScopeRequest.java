package io.github.jubasse.seampact.hooks;

import java.util.List;
import java.util.Objects;

/**
 * What the resolve-scope hook of one scope kind receives; the generated request record narrows each member.
 *
 * @param <Id> the scope's id
 * @param <Principal> the identity's principal
 * @param <ScopeExtensions> the scope's extension values
 * @param <OperationExtensions> the operation's extension values
 */
public interface ResolveScopeRequest<Id, Principal, ScopeExtensions, OperationExtensions> {
    /** The scope name. */
    String scope();

    /** Where the scope id comes from. */
    ScopeIdSource<Id> source();

    /** Null for an anonymous caller on a public or optional-auth route. */
    Principal principal();

    /** The scopes resolved before this one, outermost first. */
    List<? extends ResolvedScope<?, ?>> outerScopes();

    /** The extension values of the scope and of the operation. */
    Extensions<ScopeExtensions, OperationExtensions> extensions();

    /**
     * The extension values a scope resolver receives.
     *
     * @param scope the scope's extension values
     * @param operation the operation's extension values
     * @param <ScopeExtensions> the scope's extension values
     * @param <OperationExtensions> the operation's extension values
     */
    record Extensions<ScopeExtensions, OperationExtensions>(ScopeExtensions scope, OperationExtensions operation) {
        public Extensions {
            Objects.requireNonNull(scope, "scope");
            Objects.requireNonNull(operation, "operation");
        }
    }
}
