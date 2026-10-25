package io.github.jubasse.seampact.hooks;

/** The replay store the boundary calls when the contract enforces idempotency at the boundary. */
public interface IdempotencyStore {
    /** Claims the key, or answers why the handler must not run. */
    IdempotencyBegin begin(IdempotencyClaim claim);

    /**
     * Keeps the final response of a request that reached the handler: a success, {@code no-store} included, or an
     * error the handler answered without {@code no-store}.
     */
    void complete(String key, StoredResponse response);

    /** Releases the key after a server error or an error reply marked {@code no-store}, so the client may retry. */
    void abandon(String key);
}
