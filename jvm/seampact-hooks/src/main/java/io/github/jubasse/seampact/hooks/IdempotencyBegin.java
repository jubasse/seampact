package io.github.jubasse.seampact.hooks;

import java.util.Objects;

/**
 * The store's answer to a claim: run the handler, refuse a request still running (409), refuse a key reused with
 * another request (422), or replay the stored response.
 */
public sealed interface IdempotencyBegin
        permits IdempotencyBegin.Started, IdempotencyBegin.Running, IdempotencyBegin.Mismatch, IdempotencyBegin.Replay {
    /** The key is new: run the handler. */
    record Started() implements IdempotencyBegin {}

    /** A request with this key is still running: refuse with 409. */
    record Running() implements IdempotencyBegin {}

    /** The key was used with another request: refuse with 422. */
    record Mismatch() implements IdempotencyBegin {}

    /**
     * The request completed before: replay its response.
     *
     * @param response the stored response
     */
    record Replay(StoredResponse response) implements IdempotencyBegin {
        public Replay {
            Objects.requireNonNull(response, "response");
        }
    }
}
