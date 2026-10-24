package com.example.tasks.api.spring.runtime;

import java.util.Objects;
import java.util.Optional;

/**
 * The optional `onUnexpectedError` bean: called once for each reply the boundary replaced with the api's 500 or
 * could not finish, with the operation when one was matched. It never changes the reply.
 */
@FunctionalInterface
public interface UnexpectedErrorListener {
    void onUnexpectedError(UnexpectedFailure failure);

    /** What failed: the api, the operation, a reason without any input value, and the exception when one was thrown. */
    record UnexpectedFailure(String api, Optional<String> operation, String reason, Optional<Throwable> cause) {
        public UnexpectedFailure {
            Objects.requireNonNull(api, "api");
            Objects.requireNonNull(operation, "operation");
            Objects.requireNonNull(reason, "reason");
            Objects.requireNonNull(cause, "cause");
        }
    }
}
