package io.github.jubasse.seampact.hooks;

import java.util.Objects;

/**
 * The HTTP operation a hook is called for, as the IR names it.
 *
 * @param api the api id
 * @param id the operation id
 */
public record OperationRef(String api, String id) {
    public OperationRef {
        Objects.requireNonNull(api, "api");
        Objects.requireNonNull(id, "id");
    }
}
