import type { Awaitable, OperationRef } from "./hook-vocabulary.js";

/** What the boundary claims before it calls the handler of an idempotent operation. */
export interface IdempotencyClaim {
  /**
   * A fixed-size digest the boundary derives from the api id, the operation id, the identity id,
   * a digest of the validated principal (none for an anonymous caller) and the client key.
   * It never digests the accepted credentials, so a retry after a token or session refresh stays in the same partition.
   */
  readonly key: string;

  /** The boundary's digest of the request, compared on a reused key. */
  readonly fingerprint: string;

  /** How long the store keeps the key, from the contract's idempotency lifetime. */
  readonly lifetimeMs: number;

  readonly operation: OperationRef;
}

/** A response kept for replay, already redacted by the generated serializer. */
export interface StoredResponse {
  readonly status: number;

  /** Header names in lower case, in the order they were sent; a repeated header appears once per value. */
  readonly headers: readonly (readonly [name: string, value: string])[];

  /** Empty when the response has no body. */
  readonly body: Uint8Array;
}

/**
 * The store's answer to a claim: run the handler, refuse a request still running (409),
 * refuse a key reused with another request (422), or replay the stored response.
 */
export type IdempotencyBegin =
  | { readonly outcome: "started" }
  | { readonly outcome: "running" }
  | { readonly outcome: "mismatch" }
  | { readonly outcome: "replay"; readonly response: StoredResponse };

/** The replay store the boundary calls when the contract enforces idempotency at the boundary. */
export interface IdempotencyStore {
  begin(claim: IdempotencyClaim): Awaitable<IdempotencyBegin>;

  /** Keeps the final response of a request that reached the handler, a success or an error the handler answered. */
  complete(key: string, response: StoredResponse): Awaitable<void>;

  /** Releases the key after an unexpected failure, so the client may retry. */
  abandon(key: string): Awaitable<void>;
}
