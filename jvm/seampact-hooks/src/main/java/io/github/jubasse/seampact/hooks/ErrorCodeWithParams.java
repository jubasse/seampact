package io.github.jubasse.seampact.hooks;

import java.util.Optional;

/** A declared error code and its typed params, the only thing a hook may deny with. */
public interface ErrorCodeWithParams {
    /** The declared code. */
    String code();

    /** The code's params, empty for a code that declares none. */
    default Optional<?> params() {
        return Optional.empty();
    }
}
