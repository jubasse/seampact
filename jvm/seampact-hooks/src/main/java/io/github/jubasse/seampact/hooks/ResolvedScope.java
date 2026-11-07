package io.github.jubasse.seampact.hooks;

import java.util.Objects;
import java.util.Optional;

/**
 * A resolved scope: its id and an optional application value, carried untouched to later hooks and the handler.
 *
 * @param scope the scope name
 * @param id the scope id
 * @param value the application value
 * @param <Id> the scope's id
 * @param <Value> the application value
 */
public record ResolvedScope<Id, Value>(String scope, Id id, Optional<Value> value) {
    public ResolvedScope {
        Objects.requireNonNull(scope, "scope");
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(value, "value");
    }
}
