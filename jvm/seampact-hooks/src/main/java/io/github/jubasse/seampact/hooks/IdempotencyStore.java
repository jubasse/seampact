package io.github.jubasse.seampact.hooks;

/** The replay store the boundary calls when the contract enforces idempotency at the boundary. */
public interface IdempotencyStore {
    /** Claims the key, or answers why the handler must not run. */
    IdempotencyBegin begin(IdempotencyClaim claim);

    /** Keeps the final response of a request that reached the handler, a success or an error the handler answered. */
    void complete(String key, StoredResponse response);

    /** Releases the key after an unexpected failure, so the client may retry. */
    void abandon(String key);
}
