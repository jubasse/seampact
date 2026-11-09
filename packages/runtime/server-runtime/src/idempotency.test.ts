import type { IdempotencyBegin, IdempotencyClaim, IdempotencyStore } from "@seampact/hooks";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { CheckState } from "./access-checks.js";
import type { BoundaryContext } from "./boundary-context.js";
import { type BoundaryHooks, resolvedHooks } from "./boundary-hooks.js";
import { ContractError, type ContractReply } from "./contract-error.js";
import type { ContractApi, ContractRoute } from "./contract-route.js";
import { abandonIdempotencyClaim, beginIdempotency, settleIdempotency } from "./idempotency.js";

const KEY_HEADER = "idempotency-key";
const REPLAY_HEADER = "idempotency-replayed";
const IN_PROGRESS_CODE = "api.idempotency_in_progress";
const KEY_REUSED_CODE = "api.idempotency_key_reused";
const INTERNAL_CODE = "api.internal";
const STORE_DOWN = new Error("the store's backend is down");

const GRANT = { principal: null, scopes: [] };
const INPUT = { headers: { [KEY_HEADER]: "client-key" }, body: { title: "a" } };

afterEach(() => {
  vi.restoreAllMocks();
});

interface RecordingStore extends IdempotencyStore {
  readonly claims: IdempotencyClaim[];
  readonly completed: { key: string; status: number }[];
  readonly abandoned: string[];
}

function recordingStore(overrides: Partial<IdempotencyStore> = {}): RecordingStore {
  const claims: IdempotencyClaim[] = [];
  const completed: { key: string; status: number }[] = [];
  const abandoned: string[] = [];

  return {
    claims,
    completed,
    abandoned,
    begin: (claim): IdempotencyBegin => {
      claims.push(claim);

      return { outcome: "started" };
    },
    complete: (key, response) => {
      completed.push({ key, status: response.status });
    },
    abandon: (key) => {
      abandoned.push(key);
    },
    ...overrides,
  };
}

function stateWith(store: IdempotencyStore | undefined, hasIdempotency = true): CheckState {
  const route: unknown = {
    id: "createTask",
    method: "post",
    path: "/tasks",
    access: { kind: "public" },
    errors: {
      [INTERNAL_CODE]: {
        code: INTERNAL_CODE,
        status: 500,
        nature: "internal",
        roles: ["undeclaredStatus"],
      },
      [IN_PROGRESS_CODE]: {
        code: IN_PROGRESS_CODE,
        status: 409,
        nature: "conflict",
        roles: ["idempotencyInProgress"],
      },
      [KEY_REUSED_CODE]: {
        code: KEY_REUSED_CODE,
        status: 422,
        nature: "unprocessable",
        roles: ["idempotencyKeyReused"],
      },
    },
    ...(hasIdempotency
      ? {
          idempotency: {
            header: "Idempotency-Key",
            replayHeader: "Idempotency-Replayed",
            lifetimeMs: 1000,
            fingerprintHeaders: [],
          },
        }
      : {}),
  };
  const api: unknown = { id: "tasks" };

  return {
    api: api as ContractApi,
    route: route as ContractRoute,
    request: { method: "POST", path: "/tasks", rawQuery: "", headers: {}, body: undefined },
    pathParams: {},
    hooks: resolvedHooks(store === undefined ? {} : { idempotencyStore: store }),
    isFrameworkDenial: () => false,
    fixes: { rawBody: "", bodySize: "" },
  };
}

async function failureOf(attempt: Promise<unknown>): Promise<unknown> {
  return attempt.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function codeOf(failure: unknown): string | undefined {
  return failure instanceof ContractError ? failure.code : undefined;
}

function reply(status: number, headers: [string, string][] = []): ContractReply {
  return { status, headers, body: new TextEncoder().encode("{}") };
}

describe("beginIdempotency", () => {
  test("does nothing for an operation that is not idempotent", async () => {
    const store = recordingStore();

    await expect(beginIdempotency(stateWith(store, false), GRANT, INPUT)).resolves.toBeUndefined();
    expect(store.claims).toEqual([]);
  });

  test("does nothing when the client sent no key", async () => {
    const store = recordingStore();

    await expect(
      beginIdempotency(stateWith(store), GRANT, { headers: {} }),
    ).resolves.toBeUndefined();
    expect(store.claims).toEqual([]);
  });

  test("a key-carrying request on a route with no registered store answers 500", async () => {
    const failure = await failureOf(beginIdempotency(stateWith(undefined), GRANT, INPUT));

    expect(codeOf(failure)).toBe(INTERNAL_CODE);
  });

  test("a store that fails on begin fails the request and never starts the handler", async () => {
    const store = recordingStore({
      begin: () => {
        throw STORE_DOWN;
      },
    });

    await expect(beginIdempotency(stateWith(store), GRANT, INPUT)).rejects.toBe(STORE_DOWN);
  });

  test("a claim in progress answers the in-progress code", async () => {
    const store = recordingStore({ begin: () => ({ outcome: "running" }) });

    expect(codeOf(await failureOf(beginIdempotency(stateWith(store), GRANT, INPUT)))).toBe(
      IN_PROGRESS_CODE,
    );
  });

  test("a key reused with another request answers the key-reused code", async () => {
    const store = recordingStore({ begin: () => ({ outcome: "mismatch" }) });

    expect(codeOf(await failureOf(beginIdempotency(stateWith(store), GRANT, INPUT)))).toBe(
      KEY_REUSED_CODE,
    );
  });

  test("a claim answered with no declared in-progress code is a 500, not a pass", async () => {
    const store = recordingStore({ begin: () => ({ outcome: "running" }) });
    const state = stateWith(store);
    const route: unknown = {
      ...state.route,
      errors: { [INTERNAL_CODE]: state.route.errors[INTERNAL_CODE] },
    };

    const failure = await failureOf(
      beginIdempotency({ ...state, route: route as ContractRoute }, GRANT, INPUT),
    );

    expect(codeOf(failure)).toBe(INTERNAL_CODE);
  });

  test("a replay carries the stored reply and the replay header, once", async () => {
    const store = recordingStore({
      begin: () => ({
        outcome: "replay",
        response: {
          status: 201,
          headers: [
            ["content-type", "application/json"],
            [REPLAY_HEADER, "stale"],
          ],
          body: new Uint8Array([1]),
        },
      }),
    });

    const started = await beginIdempotency(stateWith(store), GRANT, INPUT);

    expect(started).toEqual({
      outcome: "replay",
      reply: {
        status: 201,
        headers: [
          ["content-type", "application/json"],
          [REPLAY_HEADER, "true"],
        ],
        body: new Uint8Array([1]),
      },
    });
  });

  test("a replayed error carries no replay header", async () => {
    const store = recordingStore({
      begin: () => ({
        outcome: "replay",
        response: {
          status: 422,
          headers: [["content-type", "application/json"]],
          body: new Uint8Array(),
        },
      }),
    });

    const started = await beginIdempotency(stateWith(store), GRANT, INPUT);

    expect(started).toMatchObject({
      outcome: "replay",
      reply: { status: 422, headers: [["content-type", "application/json"]] },
    });
  });

  test("the key is the same for a retry and differs by client key and by caller", async () => {
    const store = recordingStore();
    const state = stateWith(store);

    await beginIdempotency(state, GRANT, INPUT);
    await beginIdempotency(state, GRANT, INPUT);
    await beginIdempotency(state, GRANT, { headers: { [KEY_HEADER]: "other-key" } });
    await beginIdempotency(state, { identity: "user", principal: { id: "u1" }, scopes: [] }, INPUT);

    const keys = store.claims.map((claim) => claim.key);

    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the claim carries the route's lifetime and operation", async () => {
    const store = recordingStore();

    await beginIdempotency(stateWith(store), GRANT, INPUT);

    expect(store.claims[0]).toMatchObject({
      lifetimeMs: 1000,
      operation: { kind: "httpOperation", api: "tasks", id: "createTask" },
    });
  });
});

describe("settleIdempotency", () => {
  function hooksWith(store: IdempotencyStore | undefined): BoundaryHooks {
    return resolvedHooks(store === undefined ? {} : { idempotencyStore: store });
  }

  test("completes the record with a success", async () => {
    const store = recordingStore();

    await settleIdempotency(hooksWith(store), "k", reply(201));

    expect(store.completed).toEqual([{ key: "k", status: 201 }]);
  });

  test("keeps a client error for a replay", async () => {
    const store = recordingStore();

    await settleIdempotency(hooksWith(store), "k", reply(422));

    expect(store.completed).toEqual([{ key: "k", status: 422 }]);
  });

  test("abandons the key after a server error so the client may retry", async () => {
    const store = recordingStore();

    await settleIdempotency(hooksWith(store), "k", reply(503));

    expect(store.abandoned).toEqual(["k"]);
    expect(store.completed).toEqual([]);
  });

  test("abandons the key after a no-store error", async () => {
    const store = recordingStore();

    await settleIdempotency(hooksWith(store), "k", reply(429, [["cache-control", "no-store"]]));

    expect(store.abandoned).toEqual(["k"]);
  });

  test("a store that fails on complete is logged and the reply still goes out", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = recordingStore({
      complete: () => {
        throw STORE_DOWN;
      },
    });

    await expect(settleIdempotency(hooksWith(store), "k", reply(200))).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("a retry with the same key may run again"),
      STORE_DOWN,
    );
  });

  test("a store that rejects on abandon is logged and the reply still goes out", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = recordingStore({ abandon: () => Promise.reject(STORE_DOWN) });

    await expect(settleIdempotency(hooksWith(store), "k", reply(500))).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledOnce();
  });

  test("does nothing without a registered store", async () => {
    await expect(settleIdempotency(hooksWith(undefined), "k", reply(200))).resolves.toBeUndefined();
    await expect(settleIdempotency(undefined, "k", reply(200))).resolves.toBeUndefined();
  });
});

describe("abandonIdempotencyClaim", () => {
  function claimedContext(store: IdempotencyStore, idempotencyKey?: string): BoundaryContext {
    const state = stateWith(store);

    return {
      api: state.api,
      route: state.route,
      pathParams: {},
      hooks: state.hooks,
      bodyValidation: false,
      mode: "strict",
      boundaryWriting: false,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    };
  }

  test("releases the claim and clears the key, so the refusal is never stored", async () => {
    const store = recordingStore();
    const context = claimedContext(store, "k");

    await abandonIdempotencyClaim(context);

    expect(store.abandoned).toEqual(["k"]);
    expect(context.idempotencyKey).toBeUndefined();
  });

  test("does nothing without a claim", async () => {
    const store = recordingStore();

    await abandonIdempotencyClaim(claimedContext(store));

    expect(store.abandoned).toEqual([]);
  });

  test("a store that rejects on abandon is logged, and the key is still cleared", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const context = claimedContext(
      recordingStore({ abandon: () => Promise.reject(STORE_DOWN) }),
      "k",
    );

    await expect(abandonIdempotencyClaim(context)).resolves.toBeUndefined();

    expect(context.idempotencyKey).toBeUndefined();
    expect(logged).toHaveBeenCalledOnce();
  });
});
