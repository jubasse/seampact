import { describe, expect, test } from "vitest";
import {
  keyStartsWith,
  MountedKeys,
  type NextPageRule,
  nextPageRequest,
  PageRequests,
  settleAsData,
  settleForStore,
  withSignal,
} from "../../front-runtime/query-runtime.js";

const PAGE_PARAM = { in: "query", key: "page" } as const;
const OFFSET_PARAM = { in: "query", key: "offset" } as const;
const LIMIT_PARAM = { in: "query", key: "limit" } as const;

function pageOf(body: Record<string, unknown>): { readonly body: Record<string, unknown> } {
  return { body: { items: [], ...body } };
}

function itemsOfCount(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

describe("a cursor list", () => {
  const rule: NextPageRule = { position: "cursor", member: { in: "query", key: "cursor" } };

  test("sets the next cursor the page gives", () => {
    const next = nextPageRequest(rule, { query: { limit: 10 } }, pageOf({ nextCursor: "c2" }));

    expect(next).toEqual({ query: { limit: 10, cursor: "c2" } });
  });

  test("reads the cursor from a next link", () => {
    const next = nextPageRequest(rule, undefined, pageOf({ next: "/tasks?cursor=c3&limit=10" }));

    expect(next).toEqual({ query: { cursor: "c3" } });
  });

  test("ends with no cursor", () => {
    expect(nextPageRequest(rule, undefined, pageOf({ nextCursor: null }))).toBeUndefined();
  });
});

describe("a page list", () => {
  const byMore: NextPageRule = {
    position: "page",
    member: PAGE_PARAM,
    base: 1,
    evidence: ["more"],
  };

  test("moves one page while the page says more follows", () => {
    expect(nextPageRequest(byMore, { query: { page: 2 } }, pageOf({ more: true }))).toEqual({
      query: { page: 3 },
    });
    expect(
      nextPageRequest(byMore, { query: { page: 2 } }, pageOf({ more: false })),
    ).toBeUndefined();
  });

  test("starts from its base with no position in the request", () => {
    expect(nextPageRequest(byMore, undefined, pageOf({ more: true }))).toEqual({
      query: { page: 2 },
    });
  });

  test("follows the page count", () => {
    const rule: NextPageRule = {
      position: "page",
      member: PAGE_PARAM,
      base: 1,
      evidence: ["totalPages"],
    };

    expect(nextPageRequest(rule, { query: { page: 2 } }, pageOf({ totalPages: 3 }))).toEqual({
      query: { page: 3 },
    });
    expect(
      nextPageRequest(rule, { query: { page: 3 } }, pageOf({ totalPages: 3 })),
    ).toBeUndefined();
  });

  test("counts records against the total with the served limit, not the asked one", () => {
    const rule: NextPageRule = {
      position: "page",
      member: PAGE_PARAM,
      limit: LIMIT_PARAM,
      base: 1,
      evidence: ["total"],
    };
    const request = { query: { page: 2, limit: 100 } };

    expect(nextPageRequest(rule, request, pageOf({ total: 120, limit: 50 }))).toEqual({
      query: { page: 3, limit: 100 },
    });
  });

  test("counts records against the total with the item count when no limit is known", () => {
    const rule: NextPageRule = {
      position: "page",
      member: PAGE_PARAM,
      base: 1,
      evidence: ["total"],
    };
    const page = pageOf({ total: 25, items: itemsOfCount(10) });

    expect(nextPageRequest(rule, { query: { page: 2 } }, page)).toEqual({ query: { page: 3 } });
    expect(nextPageRequest(rule, { query: { page: 3 } }, page)).toBeUndefined();
  });

  test("takes the page a next link names", () => {
    const rule: NextPageRule = {
      position: "page",
      member: PAGE_PARAM,
      base: 1,
      evidence: ["next"],
    };

    expect(
      nextPageRequest(rule, { query: { page: 1 } }, pageOf({ next: "/tasks?page=4" })),
    ).toEqual({
      query: { page: 4 },
    });
    expect(nextPageRequest(rule, { query: { page: 1 } }, pageOf({ next: null }))).toBeUndefined();
  });
});

describe("an offset list", () => {
  test("steps by the served limit when the server clamps the asked one", () => {
    const rule: NextPageRule = {
      position: "offset",
      member: OFFSET_PARAM,
      limit: LIMIT_PARAM,
      base: 0,
      evidence: ["total"],
    };
    const request = { query: { offset: 0, limit: 100 } };

    expect(nextPageRequest(rule, request, pageOf({ total: 120, limit: 50 }))).toEqual({
      query: { offset: 50, limit: 100 },
    });
  });

  test("steps by the request's limit and ends at the total", () => {
    const rule: NextPageRule = {
      position: "offset",
      member: OFFSET_PARAM,
      limit: LIMIT_PARAM,
      base: 0,
      evidence: ["total"],
    };

    expect(
      nextPageRequest(rule, { query: { offset: 10, limit: 10 } }, pageOf({ total: 25 })),
    ).toEqual({
      query: { offset: 20, limit: 10 },
    });
    expect(
      nextPageRequest(rule, { query: { offset: 20, limit: 10 } }, pageOf({ total: 25 })),
    ).toBeUndefined();
  });

  test("steps by the default limit, then the item count, with no limit in the request", () => {
    const withDefault: NextPageRule = {
      position: "offset",
      member: OFFSET_PARAM,
      defaultLimit: 20,
      base: 0,
      evidence: ["more"],
    };
    const withoutLimit: NextPageRule = {
      position: "offset",
      member: OFFSET_PARAM,
      base: 0,
      evidence: ["more"],
    };
    const page = pageOf({ more: true, items: itemsOfCount(7) });

    expect(nextPageRequest(withDefault, undefined, page)).toEqual({ query: { offset: 20 } });
    expect(nextPageRequest(withoutLimit, undefined, page)).toEqual({ query: { offset: 7 } });
  });

  test("follows the page count from the pages read", () => {
    const rule: NextPageRule = {
      position: "offset",
      member: OFFSET_PARAM,
      limit: LIMIT_PARAM,
      base: 0,
      evidence: ["totalPages"],
    };

    expect(
      nextPageRequest(rule, { query: { offset: 10, limit: 10 } }, pageOf({ totalPages: 3 })),
    ).toEqual({ query: { offset: 20, limit: 10 } });
    expect(
      nextPageRequest(rule, { query: { offset: 20, limit: 10 } }, pageOf({ totalPages: 3 })),
    ).toBeUndefined();
  });

  test("takes the offset a next link names", () => {
    const rule: NextPageRule = {
      position: "offset",
      member: OFFSET_PARAM,
      defaultLimit: 10,
      base: 0,
      evidence: ["next"],
    };

    expect(nextPageRequest(rule, undefined, pageOf({ next: "/tasks?offset=15" }))).toEqual({
      query: { offset: 15 },
    });
  });

  test("ends on an empty page with no known limit", () => {
    const rule: NextPageRule = {
      position: "offset",
      member: OFFSET_PARAM,
      base: 0,
      evidence: ["more"],
    };

    expect(nextPageRequest(rule, undefined, pageOf({ more: true }))).toBeUndefined();
  });
});

describe("the call options of a query", () => {
  test("keep the caller's signal beside the library's", () => {
    const callerAbort = new AbortController();
    const libraryAbort = new AbortController();
    const call = withSignal({ timeoutMs: 500, signal: callerAbort.signal }, libraryAbort.signal);

    expect(call.timeoutMs).toBe(500);
    expect(call.signal.aborted).toBe(false);

    callerAbort.abort();

    expect(call.signal.aborted).toBe(true);
  });

  test("take the library's signal when the caller gives none", () => {
    const libraryAbort = new AbortController();
    const call = withSignal(undefined, libraryAbort.signal);

    libraryAbort.abort();

    expect(call.signal.aborted).toBe(true);
  });
});

describe("the plain values a store keeps", () => {
  const headers = new Headers({ "Content-Type": "application/json" });

  test("a success is data with its headers as a plain record", async () => {
    const outcome = await settleForStore("listTasks", Promise.resolve({ ok: true, headers }));

    expect(outcome).toEqual({
      data: { ok: true, headers: { "content-type": "application/json" } },
    });
  });

  test("a declared error is a contract value naming the operation", async () => {
    const failed = { ok: false, code: "api.rate_limited", headers };
    const outcome = await settleForStore("createTask", Promise.resolve(failed));

    expect(outcome.error).toEqual({
      kind: "contract",
      operation: "createTask",
      failure: {
        ok: false,
        code: "api.rate_limited",
        headers: { "content-type": "application/json" },
      },
    });
  });

  test("a rejection keeps its name and message, an error answer stays data under errors: data", async () => {
    const aborted = Promise.reject(new DOMException("The call was aborted.", "AbortError"));

    expect((await settleForStore("listTasks", aborted)).error).toEqual({
      kind: "rejection",
      name: "AbortError",
      message: "The call was aborted.",
    });
    expect((await settleAsData(Promise.resolve({ ok: false, headers }))).data).toEqual({
      ok: false,
      headers: { "content-type": "application/json" },
    });
  });
});

describe("keys and pages a library without filters or page params needs", () => {
  test("a key starts with its resource prefix, a record member compared by its members", () => {
    const prefix = ["tasks", { resource: "task" }];

    expect(keyStartsWith(["tasks", { resource: "task" }, "listTasks", {}], prefix)).toBe(true);
    expect(keyStartsWith(["tasks", { resource: "channel" }, "listChannels"], prefix)).toBe(false);
    expect(keyStartsWith("tasks", prefix)).toBe(false);
  });

  test("a mounted key counts its mounts and leaves on the last cleanup", () => {
    const mounted = new MountedKeys<"task">();
    const removeFirst = mounted.add("task", "$inf$key");
    const removeSecond = mounted.add("task", "$inf$key");

    removeFirst();
    expect(mounted.keysOf("task")).toEqual(["$inf$key"]);
    removeSecond();
    expect(mounted.keysOf("task")).toEqual([]);
  });

  test("the next page's request follows the request a page was read with, an unknown page refused", () => {
    const rule: NextPageRule = { position: "cursor", member: { in: "query", key: "cursor" } };
    const pages = new PageRequests<{ query?: Record<string, unknown> } | undefined>();
    const first = pages.remember(pageOf({ nextCursor: "c2" }), { query: { limit: 5 } });

    expect(pages.nextAfter(rule, first)).toEqual({ query: { limit: 5, cursor: "c2" } });
    expect(() => pages.nextAfter(rule, pageOf({ nextCursor: "c3" }))).toThrow(
      "did not read itself",
    );
  });
});
