import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { IdempotencyStore, StoredResponse } from "@seampact/hooks";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BoundaryContext } from "./boundary-context.js";
import { resolvedHooks } from "./boundary-hooks.js";
import type { ContractApi, ContractRoute, ResponsesMode } from "./contract-route.js";
import { installOutgoingCheck } from "./node-outgoing-check.js";
import { MAX_CHECKED_ERROR_BODY_BYTES } from "./outgoing-verdict.js";

// The outgoing check on a real Node response: what reaches the client when the app streams, passes headers in
// each form `writeHead` takes, or writes a reply the contract does not declare.

const PROBLEM_MEDIA = "application/problem+json";
const INTERNAL_CODE = "api.internal";
const NOT_FOUND_CODE = "api.not_found";

const API: unknown = {
  id: "tasks",
  frameworkEtag: "keep",
  format: {
    media: PROBLEM_MEDIA,
    codeMember: "code",
    mergeParams: false,
    body: {
      kind: "object",
      members: [
        { name: "code", value: { kind: "slot", slot: "code", path: [] } },
        { name: "status", value: { kind: "slot", slot: "status", path: [] } },
      ],
    },
  },
};

const ROUTE: unknown = {
  id: "getTask",
  method: "get",
  path: "/tasks",
  responses: [{ status: 200, shape: "item", payloadPath: [], headers: [] }],
  errors: {
    [INTERNAL_CODE]: {
      code: INTERNAL_CODE,
      status: 500,
      nature: "failed",
      roles: ["undeclaredStatus"],
    },
    [NOT_FOUND_CODE]: { code: NOT_FOUND_CODE, status: 404, nature: "refused", roles: ["notFound"] },
  },
};

let server: Server;
let origin: string;
let handle: (request: IncomingMessage, response: ServerResponse) => void;
let mode: ResponsesMode;
let settled: { key: string; response: StoredResponse }[];
let idempotencyKey: string | undefined;

beforeEach(async () => {
  mode = "strict";
  settled = [];
  idempotencyKey = undefined;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  const store: IdempotencyStore = {
    begin: () => ({ outcome: "started" }),
    complete: (key, response) => {
      settled.push({ key, response });
    },
    abandon: () => undefined,
  };

  server = createServer((request, response) => {
    const context: BoundaryContext = {
      api: API as ContractApi,
      route: ROUTE as ContractRoute,
      pathParams: {},
      hooks: resolvedHooks({ idempotencyStore: store }),
      bodyValidation: false,
      mode,
      boundaryWriting: false,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    };

    installOutgoingCheck(response, context, { method: "GET", path: "/tasks" });
    handle(request, response);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise((done) => server.close(done));
});

async function get() {
  const reply = await fetch(`${origin}/tasks`);

  return { status: reply.status, headers: reply.headers, text: await reply.text() };
}

describe("a declared success", () => {
  test("streamed in several chunks reaches the client whole", async () => {
    handle = (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"a":');
      response.write("1");
      response.end("}");
    };

    const reply = await get();

    expect(reply.status).toBe(200);
    expect(reply.text).toBe('{"a":1}');
  });

  test("a writeHead with a flat header list reaches the client", async () => {
    handle = (_request, response) => {
      response.writeHead(200, ["content-type", "application/json", "x-trace", "t1"]);
      response.end("{}");
    };

    const reply = await get();

    expect(reply.status).toBe(200);
    expect(reply.headers.get("x-trace")).toBe("t1");
  });

  test("a writeHead with a list of header pairs reaches the client", async () => {
    handle = (_request, response) => {
      response.writeHead(200, [
        ["content-type", "application/json"],
        ["x-trace", "t2"],
      ]);
      response.end("{}");
    };

    const reply = await get();

    expect(reply.headers.get("x-trace")).toBe("t2");
  });

  test("records the streamed body for idempotency when the request holds a key", async () => {
    idempotencyKey = "key-1";
    handle = (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"a":');
      response.end("1}");
    };

    await get();
    await vi.waitFor(() => expect(settled).toHaveLength(1));

    expect(settled[0]?.key).toBe("key-1");
    expect(new TextDecoder().decode(settled[0]?.response.body)).toBe('{"a":1}');
  });
});

describe("a reply the contract does not declare", () => {
  test("an undeclared status is replaced by the 500 under strict", async () => {
    handle = (_request, response) => {
      response.writeHead(418, { "content-type": "text/plain" });
      response.end("teapot");
    };

    const reply = await get();

    expect(reply.status).toBe(500);
    expect(JSON.parse(reply.text)).toMatchObject({ code: INTERNAL_CODE });
  });

  test("an undeclared status goes out as written under warn, and is logged once", async () => {
    mode = "warn";
    handle = (_request, response) => {
      response.writeHead(418, { "content-type": "text/plain" });
      response.end("teapot");
    };

    const reply = await get();

    expect(reply.status).toBe(418);
    expect(reply.text).toBe("teapot");
    expect(console.warn).toHaveBeenCalledOnce();
  });

  test("a declared error whose body is not the api's format is replaced by the 500", async () => {
    handle = (_request, response) => {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not here");
    };

    const reply = await get();

    expect(reply.status).toBe(500);
    expect(JSON.parse(reply.text)).toMatchObject({ code: INTERNAL_CODE });
  });

  test("a declared error in the api's format passes, streamed or not", async () => {
    handle = (_request, response) => {
      response.writeHead(404, { "content-type": PROBLEM_MEDIA });
      response.write(`{"code":"${NOT_FOUND_CODE}",`);
      response.end('"status":404}');
    };

    const reply = await get();

    expect(reply.status).toBe(404);
    expect(JSON.parse(reply.text)).toMatchObject({ code: NOT_FOUND_CODE });
  });

  test("a declared error body above the checked size is replaced by the 500", async () => {
    handle = (_request, response) => {
      response.writeHead(404, { "content-type": PROBLEM_MEDIA });
      response.write("x".repeat(MAX_CHECKED_ERROR_BODY_BYTES + 1));
      response.end();
    };

    const reply = await get();

    expect(reply.status).toBe(500);
    expect(JSON.parse(reply.text)).toMatchObject({ code: INTERNAL_CODE });
  });
});
