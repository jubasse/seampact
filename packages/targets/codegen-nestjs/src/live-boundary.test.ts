import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  emitProject,
  generateReferenceProject,
  projectDirectory,
} from "./reference-project.test-support.js";

// Boots NestJS with Express around the generated `tasks` boundary (the app in `test-app/`) and sends requests to
// it: the wire behaviour the compile test cannot see.

const PROJECT = projectDirectory("live-boundary");
const BUILD = join(PROJECT, "build");
const APP_SOURCE = new URL("../test-app/reference-app.js", import.meta.url);
const REPLY_TIMEOUT_MILLISECONDS = 3000;

const CHANNEL = "11111111-1111-4111-8111-111111111111";
const OTHER_CHANNEL = "22222222-2222-4222-8222-222222222222";
const TASK = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
const BEARER = { authorization: `Bearer user-${USER}` };
const PROBLEM_MEDIA = "application/problem+json";

function writeHeaders(): Record<string, string> {
  return { ...BEARER, "idempotency-key": randomUUID() };
}

interface UnexpectedCall {
  readonly exceptionOrReply: unknown;
  readonly context: { readonly operation?: string };
}

interface ReferenceAppModule {
  readonly ALLOWED_ORIGIN: string;
  readonly calls: {
    readonly scopeIds: unknown[];
    readonly handled: string[];
    readonly unexpected: UnexpectedCall[];
    readonly loggedErrors: string[];
  };
  readonly scenario: {
    answers: Record<string, (input: unknown) => unknown>;
    authenticate: (request: unknown) => unknown;
    decide: (request: { name: string; purpose: { direction?: string } }) => unknown;
  };
  readonly AppReply: new (
    status: number,
    contentType: string,
    body: string,
    writer?: "send" | "writeHead",
  ) => Error;
  resetScenario(): void;
  startReferenceApp(): Promise<{ host: string; port: number; close(): Promise<void> }>;
}

interface Reply {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly text: string;
}

let app: ReferenceAppModule;
let server: Awaited<ReturnType<ReferenceAppModule["startReferenceApp"]>>;

// A raw request: the path goes out byte for byte, without WHATWG URL normalization.
function send(
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: server.host,
        port: server.port,
        method,
        path,
        headers: {
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...options.headers,
        },
        timeout: REPLY_TIMEOUT_MILLISECONDS,
      },
      (incoming) => {
        const chunks: Buffer[] = [];

        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );

    outgoing.on("timeout", () => {
      outgoing.destroy();
      reject(new Error(`${method} ${path} got no reply within ${REPLY_TIMEOUT_MILLISECONDS} ms`));
    });
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

function problemBody(code: string, status: number): string {
  return JSON.stringify({ type: code, title: code, status, code, nature: "refused" });
}

beforeAll(async () => {
  const files = await generateReferenceProject(PROJECT, { bodyValidation: true });

  expect(emitProject(PROJECT, files, BUILD)).toEqual([]);

  mkdirSync(join(BUILD, "app"), { recursive: true });
  copyFileSync(APP_SOURCE, join(BUILD, "app", "reference-app.js"));
  app = await import(pathToFileURL(join(BUILD, "app", "reference-app.js")).href);
  server = await app.startReferenceApp();
});

afterAll(async () => {
  await server?.close();
});

beforeEach(() => {
  app.resetScenario();
  vi.restoreAllMocks();
});

describe("replies on contract routes", () => {
  test("a violation under responses: warn still reaches the client as written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    app.scenario.answers.getChannel = () => {
      throw new app.AppReply(418, "text/plain", "teapot");
    };

    const reply = await send("GET", `/v1/channels/${CHANNEL}`, { headers: BEARER });

    expect(reply).toMatchObject({ status: 418, text: "teapot" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("the undeclared status 418"));
  });

  test("the app's middleware and CORS headers stay on contract replies, refusals included", async () => {
    const headers = { origin: app.ALLOWED_ORIGIN };
    const served = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, {
      headers: { ...BEARER, ...headers },
    });
    const refused = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, { headers });

    for (const [reply, status] of [
      [served, 200],
      [refused, 401],
    ] as const) {
      expect(reply.status).toBe(status);
      expect(reply.headers).toMatchObject({
        "access-control-allow-origin": app.ALLOWED_ORIGIN,
        "strict-transport-security": "max-age=63072000",
        "x-content-type-options": "nosniff",
      });
      expect(reply.headers.vary).toContain("Origin");
    }
  });

  test.each(["send", "writeHead"] as const)(
    "an app filter's declared error written with %s carries no foreign ETag",
    async (writer) => {
      app.scenario.answers.getTask = () => {
        throw new app.AppReply(404, PROBLEM_MEDIA, problemBody("api.not_found", 404), writer);
      };

      const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, {
        headers: BEARER,
      });

      expect(app.calls.unexpected).toEqual([]);
      expect(reply.status).toBe(404);
      expect(reply.headers.etag).toBeUndefined();
      expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
    },
  );
});

describe("the request the boundary checks is the one Express routes", () => {
  test("a backslash path is read raw, so the scope checked is the routed channel", async () => {
    const path = `/v1/channels/${CHANNEL}/tasks/..\\..\\${OTHER_CHANNEL}\\tasks\\${TASK}`;
    const reply = await send("GET", path, { headers: BEARER });

    expect(app.calls.scopeIds).not.toContain(OTHER_CHANNEL);
    expect(reply.status).not.toBe(200);
  });
});

describe("hooks that answer outside their contract", () => {
  test("a decider failure on a restricted input field is a 500 reported to the hook", async () => {
    app.scenario.decide = (request) =>
      request.purpose.direction === "input" ? { nothing: true } : { allow: true };

    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: writeHeaders(),
      body: JSON.stringify({ title: "Plan", effort: 2 }),
    });

    expect(reply.status).toBe(500);
    expect(reply.text).not.toContain("pointer");
    expect(app.calls.unexpected).toHaveLength(1);
    expect(app.calls.handled).not.toContain("createTask");
  });

  test("an authenticate hook answering a null principal does not authenticate", async () => {
    app.scenario.authenticate = () => ({ principal: null });

    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: writeHeaders(),
      body: JSON.stringify({ title: "Plan" }),
    });

    expect(reply.status).toBe(500);
    expect(app.calls.handled).not.toContain("createTask");
  });
});

describe("the app's own routes keep NestJS's behaviour", () => {
  test("a parser 413 on an app route answers NestJS's 413", async () => {
    const reply = await send("POST", "/own/echo", {
      body: JSON.stringify({ padding: "x".repeat(3 * 1024 * 1024) }),
    });

    expect(reply.status).toBe(413);
  });

  test("an app route's unexpected error is logged by NestJS", async () => {
    const reply = await send("GET", "/own/boom");

    expect(reply.status).toBe(500);
    expect(app.calls.loggedErrors.join("\n")).toContain("own boom");
  });
});

describe("requests the contract does not serve as sent", () => {
  test.each([
    ["a trailing slash", "GET", `/v1/channels/${CHANNEL}/tasks/${TASK}/`],
    ["an upper-case path", "GET", `/V1/channels/${CHANNEL}/tasks/${TASK}`],
    ["HEAD on a GET route", "HEAD", `/v1/channels/${CHANNEL}/tasks/${TASK}`],
    ["a method the path does not serve", "PUT", `/v1/channels/${CHANNEL}/tasks/${TASK}`],
  ])("%s answers the path's 404", async (_case, method, path) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reply = await send(method, path, { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(error).not.toHaveBeenCalled();
    expect(app.calls.handled).toEqual([]);
  });
});

describe("idempotency", () => {
  test("the same body with its members reordered replays the first reply", async () => {
    const headers = writeHeaders();
    const path = `/v1/channels/${CHANNEL}/tasks`;
    const first = await send("POST", path, {
      headers,
      body: JSON.stringify({ title: "Plan", effort: 2 }),
    });
    const second = await send("POST", path, {
      headers,
      body: JSON.stringify({ effort: 2, title: "Plan" }),
    });

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.text).toBe(first.text);
    expect(app.calls.handled).toEqual(["createTask"]);
  });
});

describe("validation", () => {
  test("schemaInvalid issues name the contract's rules, never the validator's codes", async () => {
    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: writeHeaders(),
      body: JSON.stringify({ title: "", effort: -1, extra: true }),
    });

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.text).issues).toEqual(
      expect.arrayContaining([
        { pointer: "/title", rule: "minLength" },
        { pointer: "/effort", rule: "minimum" },
        { pointer: "/extra", rule: "unknownKeys" },
      ]),
    );
  });

  test("a missing member and a malformed format name required and format", async () => {
    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks/${TASK}/assign`, {
      headers: writeHeaders(),
      body: JSON.stringify({}),
    });
    const malformed = await send("GET", `/v1/channels/not-a-uuid/tasks/${TASK}`, {
      headers: BEARER,
    });

    expect(JSON.parse(reply.text).issues).toEqual([{ pointer: "/userId", rule: "required" }]);
    expect(JSON.parse(malformed.text).issues).toEqual([{ pointer: "/channelId", rule: "format" }]);
  });

  test("a page limit the client does not send reaches the handler as the contract's default", async () => {
    let received: unknown;

    app.scenario.answers.listTasks = (input) => {
      received = input;

      return { status: 200, body: { items: [] } };
    };

    const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks`, { headers: BEARER });

    expect(reply.status).toBe(200);
    expect(received).toMatchObject({ query: { limit: 50 } });
  });
});
