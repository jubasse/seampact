package io.github.jubasse.seampact.hooks;

import java.util.Objects;

/**
 * Where the scope id comes from: the declared source, decoded and validated, or a custom resolver reading the request.
 *
 * @param <Id> the scope's id
 */
public sealed interface ScopeIdSource<Id> permits ScopeIdSource.Declared, ScopeIdSource.Custom {
    /**
     * The id from the scope's declared source, decoded and validated against the scope's id schema.
     *
     * @param id the scope id
     */
    record Declared<Id>(Id id) implements ScopeIdSource<Id> {
        public Declared {
            Objects.requireNonNull(id, "id");
        }
    }

    /**
     * A custom resolver: no id, the request to read it from.
     *
     * @param request a read-only view of the request
     */
    record Custom<Id>(RequestView request) implements ScopeIdSource<Id> {
        public Custom {
            Objects.requireNonNull(request, "request");
        }
    }
}
