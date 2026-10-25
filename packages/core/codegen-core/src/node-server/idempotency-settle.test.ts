import type { IdempotencyStore, StoredResponse } from "@seampact/hooks";
import { describe, expect, test } from "vitest";
import type { BoundaryHooks } from "../../node-server-runtime/boundary-hooks.js";
import { settleIdempotency } from "../../node-server-runtime/idempotency.js";

interface RecordingStore extends IdempotencyStore {
  readonly completed: string[];
  readonly abandoned: string[];
}

function recordingStore(): RecordingStore {
  const completed: string[] = [];
  const abandoned: string[] = [];

  return {
    completed,
    abandoned,
    begin: () => ({ outcome: "started" }),
    complete: (key: string, _response: StoredResponse) => {
      completed.push(key);
    },
    abandon: (key: string) => {
      abandoned.push(key);
    },
  };
}

function hooksWith(store: IdempotencyStore): BoundaryHooks {
  return { authenticate: {}, deciders: [], scopeResolvers: {}, idempotencyStore: store };
}

describe("settling an idempotent request", () => {
  test("a reply marked no-store is not kept for a replay", async () => {
    const store = recordingStore();
    const reply = {
      status: 201,
      headers: [["Cache-Control", "private, No-Store"]] as const,
      body: new Uint8Array(),
    };

    await settleIdempotency(hooksWith(store), "key-1", reply);

    expect(store.completed).toEqual([]);
    expect(store.abandoned).toEqual(["key-1"]);
  });

  test("a reply without no-store is kept for a replay", async () => {
    const store = recordingStore();
    const reply = {
      status: 201,
      headers: [["cache-control", "private"]] as const,
      body: new Uint8Array(),
    };

    await settleIdempotency(hooksWith(store), "key-1", reply);

    expect(store.completed).toEqual(["key-1"]);
  });
});
