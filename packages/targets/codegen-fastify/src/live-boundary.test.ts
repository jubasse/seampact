import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  copyTestApp,
  emitProject,
  generateReferenceProject,
  problemBody,
  projectDirectory,
  type RawReply,
  sendRawRequest,
} from "@seampact/codegen-core/node-server/test-support";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { target as fastifyTarget } from "./index.js";

// Boots a Fastify app around the generated `tasks` plugin (the app in `test-app/`) and sends requests to it: the
// wire behaviour the compile test cannot see.

const PROJECT = projectDirectory(import.meta.url, "live-boundary");
const BUILD = join(PROJECT, "build");
const APP_SOURCE = new URL("../test-app/reference-app.js", import.meta.url);
// Generating and compiling both apis outruns vitest's default 10 s hook limit on a loaded machine.
const SETUP_TIMEOUT_MILLISECONDS = 60_000;

const CHANNEL = "11111111-1111-4111-8111-111111111111";
const TASK = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
const BEARER = { authorization: `Bearer user-${USER}` };
const PROBLEM_MEDIA = "application/problem+json";
const TOO_LARGE_BODY_BYTES = 1_048_577;
const LONGER_THAN_MAX_PARAM_LENGTH = 101;

interface ReferenceAppModule {
  readonly ALLOWED_ORIGIN: string;
  readonly FAIL_BEFORE_HEADER: string;
  readonly calls: {
    readonly handled: string[];
    readonly unexpected: unknown[];
    readonly loggedErrors: string[];
  };
  readonly scenario: { answers: Record<string, (input: unknown) => unknown> };
  readonly AppReply: new (
    status: number,
    contentType: string,
    body: string,
    writer?: string,
  ) => Error;
  readonly handlers: Record<string, object>;
  readonly hooks: object;
  resetScenario(): void;
  bootWith(registration: object, instanceOptions?: object, prefix?: string): Promise<void>;
  bootTwice(registration: object): Promise<void>;
  startReferenceApp(): Promise<{ host: string; port: number; close(): Promise<void> }>;
}

let app: ReferenceAppModule;
let server: Awaited<ReturnType<ReferenceAppModule["startReferenceApp"]>>;

function send(
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: string | Buffer } = {},
): Promise<RawReply> {
  return sendRawRequest(server, method, path, options);
}

function writeHeaders(): Record<string, string> {
  return { ...BEARER, "idempotency-key": randomUUID() };
}

beforeAll(async () => {
  const files = await generateReferenceProject(PROJECT, fastifyTarget, { bodyValidation: true });

  expect(emitProject(PROJECT, files, BUILD)).toEqual([]);
  app = await import(copyTestApp(BUILD, APP_SOURCE));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  server = await app.startReferenceApp();
}, SETUP_TIMEOUT_MILLISECONDS);

afterAll(async () => {
  await server?.close();
});

beforeEach(() => {
  app.resetScenario();
  vi.restoreAllMocks();
});

describe("replies on contract routes", () => {
  test("every operation's handler is called on its object, so `this` is kept", async () => {
    const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, { headers: BEARER });

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toMatchObject({ taskId: TASK });
    expect(app.calls.handled).toEqual(["getTask"]);
  });

  test("an operation override under responses: warn lets a violation reach the client", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    app.scenario.answers.getChannel = () => {
      throw new app.AppReply(418, "text/plain", "teapot");
    };

    const reply = await send("GET", `/v1/channels/${CHANNEL}`, { headers: BEARER });

    expect(reply).toMatchObject({ status: 418, text: "teapot" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("the undeclared status 418"));
  });

  test("the same violation without the override is replaced by a 500", async () => {
    app.scenario.answers.getTask = () => {
      throw new app.AppReply(418, "text/plain", "teapot");
    };

    const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, { headers: BEARER });

    expect(reply.status).toBe(500);
    expect(app.calls.unexpected).toHaveLength(1);
  });

  test("headers an app root hook sets reach contract replies, refusals included", async () => {
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
        "x-content-type-options": "nosniff",
      });
      expect(reply.headers.vary).toContain("Origin");
    }
  });

  test.each(["send", "writeHead"] as const)(
    "an app error handler's declared error written with %s passes without a foreign ETag",
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
    },
  );

  test("a gzip error body from the app error handler is decoded, checked and passes", async () => {
    app.scenario.answers.getTask = () => {
      throw new app.AppReply(
        404,
        PROBLEM_MEDIA,
        problemBody("api.not_found", 404),
        "encoding:gzip",
      );
    };

    const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(reply.headers["content-encoding"]).toBe("gzip");
    expect(app.calls.unexpected).toEqual([]);
  });

  test("an app root hook's 401 reaches the plugin's error handler and answers in the api's format", async () => {
    const reply = await send("GET", "/v1/me/preferences", {
      headers: { [app.FAIL_BEFORE_HEADER]: "401" },
    });

    expect(reply.status).toBe(401);
    expect(JSON.parse(reply.text)).toMatchObject({ code: "api.unauthenticated" });
  });
});

describe("the request body", () => {
  test("a malformed body and a body over the route's limit answer in the api's format", async () => {
    const path = `/v1/channels/${CHANNEL}/tasks`;
    const malformed = await send("POST", path, { headers: writeHeaders(), body: "{" });
    const tooLarge = await send("POST", path, {
      headers: writeHeaders(),
      body: JSON.stringify({ title: "x".repeat(TOO_LARGE_BODY_BYTES) }),
    });

    expect(malformed.status).toBe(400);
    expect(malformed.headers["content-type"]).toContain(PROBLEM_MEDIA);
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.headers["content-type"]).toContain(PROBLEM_MEDIA);
    expect(app.calls.handled).toEqual([]);
  });

  test("a body that is not JSON answers the 415 before it is read", async () => {
    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: { ...writeHeaders(), "content-type": "text/plain" },
      body: "title",
    });

    expect(reply.status).toBe(415);
    expect(app.calls.handled).toEqual([]);
  });

  test("a gzip request body is inflated before it is parsed", async () => {
    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: { ...writeHeaders(), "content-encoding": "gzip" },
      body: gzipSync(JSON.stringify({ title: "Plan" })),
    });

    expect(reply.status).toBe(201);
    expect(app.calls.handled).toEqual(["createTask"]);
  });

  test("a body in an unknown content coding answers the 415", async () => {
    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: { ...writeHeaders(), "content-encoding": "x-custom" },
      body: JSON.stringify({ title: "Plan" }),
    });

    expect(reply.status).toBe(415);
    expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
  });

  test("a scalar JSON body is a step 6 issue, not a malformed body", async () => {
    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: writeHeaders(),
      body: '"Plan"',
    });

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.text).issues).toBeDefined();
  });
});

describe("requests the contract does not serve as sent", () => {
  test.each(["HEAD", "DELETE", "OPTIONS"])(
    "%s on a path that declares no 404 answers a bare 404, not a failure",
    async (method) => {
      const reply = await send(method, "/v1/health");

      expect(reply.status).toBe(404);
      expect(reply.text).toBe("");
      expect(app.calls.unexpected).toEqual([]);
    },
  );

  test.each([
    ["HEAD on a GET route", "HEAD"],
    ["a method the path does not serve", "PUT"],
    ["OPTIONS", "OPTIONS"],
  ])("%s answers the path's 404 in the api's format", async (_case, method) => {
    const reply = await send(method, `/v1/channels/${CHANNEL}/tasks/${TASK}`, { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(app.calls.handled).toEqual([]);

    if (method !== "HEAD") expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
  });

  test("a path no contract route serves is the app's own 404", async () => {
    const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}/`, { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(reply.headers["content-type"] ?? "").not.toContain(PROBLEM_MEDIA);
  });

  test.each([
    ["an undecodable path param", `/v1/channels/%E0%A4%A/tasks/${TASK}`],
    [
      "a path param over maxParamLength",
      `/v1/channels/${"a".repeat(LONGER_THAN_MAX_PARAM_LENGTH)}/tasks/${TASK}`,
    ],
  ])("%s answers the operation's 400 through frameworkErrors", async (_case, path) => {
    const reply = await send("GET", path, { headers: BEARER });

    expect(reply.status).toBe(400);
    expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
  });
});

describe("the app's own routes keep Fastify's behaviour", () => {
  test("an app route's error reaches the app's error handler", async () => {
    const reply = await send("GET", "/own/boom");

    expect(reply.status).toBe(500);
    expect(app.calls.loggedErrors.join("\n")).toContain("own boom");
  });

  test("an app route keeps the app's JSON parser", async () => {
    const reply = await send("POST", "/own/echo", { body: "{" });

    expect(reply.status).toBe(400);
    expect(reply.headers["content-type"] ?? "").not.toContain(PROBLEM_MEDIA);
  });
});

describe("the contract's checks", () => {
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

  test("schemaInvalid issues name the contract's rules", async () => {
    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: writeHeaders(),
      body: JSON.stringify({ title: "", extra: true }),
    });

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.text).issues).toEqual(
      expect.arrayContaining([
        { pointer: "/title", rule: "minLength" },
        { pointer: "/extra", rule: "unknownKeys" },
      ]),
    );
  });
});

describe("the boot check", () => {
  test("lists a missing handler, an unknown override and a prefix at once", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { TasksEndpoints: _omitted, ...handlers } = app.handlers;

    await expect(
      app.bootWith({ handlers, hooks: app.hooks, operations: { nothing: {} } }, {}, "/v1"),
    ).rejects.toThrow(/TasksEndpoints[\s\S]*'operations' names 'nothing'[\s\S]*prefix '\/v1'/);
  });

  test("a second registration of the api in one app stops the boot", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(app.bootTwice({ handlers: app.handlers, hooks: app.hooks })).rejects.toThrow(
      /registered twice/,
    );
  });
});
