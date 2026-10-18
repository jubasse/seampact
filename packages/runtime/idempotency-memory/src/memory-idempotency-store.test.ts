import type { IdempotencyClaim } from "@seampact/hooks";
import { expect, test } from "vitest";
import { createMemoryIdempotencyStore } from "./memory-idempotency-store.js";

const LIFETIME_MS = 100;
const AFTER_LIFETIME_MS = 150;

function claim(fingerprint: string): IdempotencyClaim {
  return {
    key: "k",
    fingerprint,
    lifetimeMs: LIFETIME_MS,
    operation: { kind: "httpOperation", api: "tasks", id: "createTask" },
  };
}

test("a running entry past its lifetime is kept, so a late complete cannot land on another request", () => {
  let nowMs = 0;
  const store = createMemoryIdempotencyStore({ now: () => nowMs });

  expect(store.begin(claim("a"))).toEqual({ outcome: "started" });

  nowMs = AFTER_LIFETIME_MS;

  expect(store.begin(claim("b"))).toEqual({ outcome: "mismatch" });
  expect(store.begin(claim("a"))).toEqual({ outcome: "running" });
});

test("a completed entry past its lifetime is swept", () => {
  let nowMs = 0;
  const store = createMemoryIdempotencyStore({ now: () => nowMs });

  store.begin(claim("a"));
  store.complete("k", { status: 200, headers: [], body: new Uint8Array() });

  nowMs = AFTER_LIFETIME_MS;

  expect(store.begin(claim("b"))).toEqual({ outcome: "started" });
});
