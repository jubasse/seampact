package io.github.jubasse.seampact.hooks;

import java.util.Objects;

/**
 * What the boundary claims before it calls the handler of an idempotent operation.
 *
 * @param key a fixed-size digest the boundary derives from the api id, the operation id, the identity id, a digest of
 *     the validated principal (none for an anonymous caller) and the client key; it never digests the accepted
 *     credentials, so a retry after a token or session refresh stays in the same partition
 * @param fingerprint the boundary's digest of the request, compared on a reused key
 * @param lifetimeMs how long the store keeps the key, from the contract's idempotency lifetime
 * @param operation the operation the claim is for
 */
public record IdempotencyClaim(String key, String fingerprint, long lifetimeMs, OperationRef operation) {
    public IdempotencyClaim {
        Objects.requireNonNull(key, "key");
        Objects.requireNonNull(fingerprint, "fingerprint");
        Objects.requireNonNull(operation, "operation");
    }
}
