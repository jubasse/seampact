import type {
  IdempotencyBegin,
  IdempotencyClaim,
  IdempotencyStore,
  StoredResponse,
} from "@seampact/hooks";

export interface MemoryIdempotencyStoreOptions {
  /** The most keys kept at once; the oldest completed key is evicted to make room. */
  readonly maxEntries?: number;

  /** The current time in milliseconds since the Unix epoch; `Date.now` when absent. */
  readonly now?: () => number;
}

export const DEFAULT_MAX_ENTRIES = 10_000;

interface Entry {
  readonly fingerprint: string;
  readonly expiresAtMs: number;

  /** Absent while the request is still running. */
  response?: StoredResponse;
}

/** Thrown when every kept key belongs to a request still running, so no completed key can make room. */
export class IdempotencyStoreFullError extends Error {
  readonly code = "idempotency.store.full";

  constructor(readonly maxEntries: number) {
    super(
      `The memory idempotency store holds ${maxEntries} keys of requests still running; raise 'maxEntries' or use a shared store.`,
    );
  }
}

/**
 * An idempotency store kept in this process's memory: one process only, and every key is lost on restart, so it
 * suits development and tests. Keys are the boundary's fixed-size digests, kept until their lifetime ends.
 */
export function createMemoryIdempotencyStore(
  options: MemoryIdempotencyStoreOptions = {},
): IdempotencyStore {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? Date.now;

  // A Map keeps insertion order, so the first completed entry found is the oldest.
  const entries = new Map<string, Entry>();

  function sweepExpired(nowMs: number): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAtMs <= nowMs) entries.delete(key);
    }
  }

  function makeRoom(): void {
    if (entries.size < maxEntries) return;

    for (const [key, entry] of entries) {
      if (entry.response === undefined) continue;

      entries.delete(key);

      return;
    }

    throw new IdempotencyStoreFullError(maxEntries);
  }

  return {
    begin(claim: IdempotencyClaim): IdempotencyBegin {
      const nowMs = now();

      sweepExpired(nowMs);

      const existing = entries.get(claim.key);

      if (existing !== undefined) return answerExisting(existing, claim.fingerprint);

      makeRoom();
      entries.set(claim.key, {
        fingerprint: claim.fingerprint,
        expiresAtMs: nowMs + claim.lifetimeMs,
      });

      return { outcome: "started" };
    },

    complete(key: string, response: StoredResponse): void {
      const entry = entries.get(key);

      // A key whose lifetime ended while its request ran has nothing left to replay.
      if (entry === undefined) return;

      entry.response = copyResponse(response);
    },

    abandon(key: string): void {
      entries.delete(key);
    },
  };
}

function answerExisting(entry: Entry, fingerprint: string): IdempotencyBegin {
  if (entry.fingerprint !== fingerprint) return { outcome: "mismatch" };

  if (entry.response === undefined) return { outcome: "running" };

  return { outcome: "replay", response: copyResponse(entry.response) };
}

// The store neither keeps nor hands out the caller's arrays, so neither side can change a kept response.
function copyResponse(response: StoredResponse): StoredResponse {
  return {
    status: response.status,
    headers: response.headers.map(([name, value]) => [name, value] as const),
    body: Uint8Array.from(response.body),
  };
}
