import type { IdempotencyClaim } from "@seampact/hooks";
import { expect, test } from "vitest";
import {
  createMemoryIdempotencyStore,
  IdempotencyStoreFullError,
} from "./memory-idempotency-store.js";

const LIFETIME_MS = 100;
const AFTER_LIFETIME_MS = 150;

function claim(fingerprint: string, key = "k"): IdempotencyClaim {
  return {
    key,
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

const OK_RESPONSE = { status: 200, headers: [["x-a", "1"]] as const, body: new Uint8Array([1, 2]) };

function completeKey(store: ReturnType<typeof createMemoryIdempotencyStore>, key: string): void {
  store.begin(claim("a", key));
  store.complete(key, { ...OK_RESPONSE, headers: [...OK_RESPONSE.headers] });
}

test("a completed key replays its stored response", () => {
  const store = createMemoryIdempotencyStore();

  completeKey(store, "k");

  expect(store.begin(claim("a"))).toEqual({ outcome: "replay", response: OK_RESPONSE });
});

test("a replay hands out a copy, so changing it leaves the kept response intact", async () => {
  const store = createMemoryIdempotencyStore();

  completeKey(store, "k");

  const first = await store.begin(claim("a"));

  if (first.outcome !== "replay") throw new Error("expected a replay");

  first.response.body[0] = 99;

  expect(store.begin(claim("a"))).toMatchObject({ response: { body: new Uint8Array([1, 2]) } });
});

test("complete keeps a copy, so changing the caller's body later leaves the kept response intact", () => {
  const store = createMemoryIdempotencyStore();
  const body = new Uint8Array([1, 2]);

  store.begin(claim("a"));
  store.complete("k", { status: 200, headers: [], body });
  body[0] = 99;

  expect(store.begin(claim("a"))).toMatchObject({ response: { body: new Uint8Array([1, 2]) } });
});

test("a completed key used with another fingerprint before it expires is a mismatch", () => {
  const store = createMemoryIdempotencyStore();

  completeKey(store, "k");

  expect(store.begin(claim("b"))).toEqual({ outcome: "mismatch" });
});

test("an abandoned key can be claimed again", () => {
  const store = createMemoryIdempotencyStore();

  store.begin(claim("a"));
  store.abandon("k");

  expect(store.begin(claim("b"))).toEqual({ outcome: "started" });
});

test("a complete after an abandon records nothing", () => {
  const store = createMemoryIdempotencyStore();

  store.begin(claim("a"));
  store.abandon("k");
  store.complete("k", { ...OK_RESPONSE, headers: [...OK_RESPONSE.headers] });

  expect(store.begin(claim("a"))).toEqual({ outcome: "started" });
});

test("at maxEntries the oldest completed key is evicted to make room", () => {
  const store = createMemoryIdempotencyStore({ maxEntries: 2 });

  completeKey(store, "first");
  completeKey(store, "second");
  store.begin(claim("a", "third"));

  expect(store.begin(claim("a", "second"))).toMatchObject({ outcome: "replay" });
  expect(store.begin(claim("a", "first"))).toEqual({ outcome: "started" });
});

test("eviction skips a running key to take the oldest completed one", () => {
  const store = createMemoryIdempotencyStore({ maxEntries: 2 });

  store.begin(claim("a", "running"));
  completeKey(store, "done");
  store.begin(claim("a", "third"));

  expect(store.begin(claim("a", "running"))).toEqual({ outcome: "running" });
  // "done" was evicted, so it is claimed anew, and only running keys are left: no room for it.
  expect(() => store.begin(claim("a", "done"))).toThrow(IdempotencyStoreFullError);
});

test("when every kept key is still running a new key is refused with IdempotencyStoreFullError", () => {
  const store = createMemoryIdempotencyStore({ maxEntries: 2 });

  store.begin(claim("a", "one"));
  store.begin(claim("a", "two"));

  expect(() => store.begin(claim("a", "three"))).toThrow(IdempotencyStoreFullError);
  expect(store.begin(claim("a", "one"))).toEqual({ outcome: "running" });
});
