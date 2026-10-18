import { randomUUID } from "node:crypto";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import { target as expressTarget } from "./index.js";

// Boots an Express app around the generated `tasks` router (the app in `test-app/`), once on Express 5 and once on
// Express 4, and sends requests to it: the wire behaviour the compile test cannot see.

const APP_SOURCE = new URL("../test-app/reference-app.js", import.meta.url);
// The installed package of each major: `express4` is this package's alias of Express 4.
const EXPRESS_MAJORS = [
  ["Express 5", "express"],
  ["Express 4", "express4"],
] as const;
// Generating and compiling both apis outruns vitest's default 10 s hook limit on a loaded machine.
const SETUP_TIMEOUT_MILLISECONDS = 60_000;

const CHANNEL = "11111111-1111-4111-8111-111111111111";
const OTHER_CHANNEL = "22222222-2222-4222-8222-222222222222";
const TASK = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
const BEARER = { authorization: `Bearer user-${USER}` };
const PROBLEM_MEDIA = "application/problem+json";
const TOO_LARGE_BODY_BYTES = 1_048_577;

interface ReferenceAppModule {
  readonly ALLOWED_ORIGIN: string;
  readonly FAIL_BEFORE_HEADER: string;
  readonly calls: {
    readonly scopeIds: unknown[];
    readonly handled: string[];
    readonly unexpected: unknown[];
    readonly loggedErrors: string[];
  };
  readonly scenario: {
    answers: Record<string, (input: unknown) => unknown>;
    decide: (request: { name: string; purpose: { direction?: string } }) => unknown;
  };
  readonly AppReply: new (
    status: number,
    contentType: string,
    body: string,
    writer?: string,
  ) => Error;
  readonly handlers: Record<string, object>;
  readonly hooks: object;
  resetScenario(): void;
  startReferenceApp(): Promise<{ host: string; port: number; close(): Promise<void> }>;
}

interface RouterModule {
  router(options: unknown): unknown;
}

function writeHeaders(): Record<string, string> {
  return { ...BEARER, "idempotency-key": randomUUID() };
}

describe.each(EXPRESS_MAJORS)("the generated router on %s", (_major, expressPackage) => {
  const project = projectDirectory(import.meta.url, `live-boundary-${expressPackage}`);
  const build = join(project, "build");
  let app: ReferenceAppModule;
  let server: Awaited<ReturnType<ReferenceAppModule["startReferenceApp"]>>;

  const send = (
    method: string,
    path: string,
    options: { headers?: Record<string, string>; body?: string | Buffer } = {},
  ): Promise<RawReply> => sendRawRequest(server, method, path, options);

  beforeAll(async () => {
    const files = await generateReferenceProject(project, expressTarget, { bodyValidation: true });

    expect(emitProject(project, files, build)).toEqual([]);
    linkExpress(project, expressPackage);
    app = await import(copyTestApp(build, APP_SOURCE));
    server = await app.startReferenceApp();
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await server?.close();
  });

  beforeEach(() => {
    app.resetScenario();
    vi.restoreAllMocks();
  });

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

  test("the app's middleware headers stay on contract replies, refusals included", async () => {
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
    "an app error middleware's declared error written with %s carries no foreign ETag",
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

  test("a boundary reply gets no Express ETag and no 304", async () => {
    const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, {
      headers: { ...BEARER, "if-none-match": "*" },
    });

    expect(reply.status).not.toBe(304);
    expect(reply.headers.etag ?? "").not.toMatch(/^W\//);
  });

  test("a gzip error body in the api's format is decoded, checked and passes", async () => {
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

  test("a malformed percent-encoding in a path param is a step 6 issue, not a URIError", async () => {
    const reply = await send("GET", `/v1/channels/%E0%A4%A/tasks/${TASK}`, { headers: BEARER });

    expect(reply.status).toBe(400);
    expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
  });

  test("a backslash path is read raw, so the scope checked is the routed channel", async () => {
    const path = `/v1/channels/${CHANNEL}/tasks/..\\..\\${OTHER_CHANNEL}\\tasks\\${TASK}`;
    const reply = await send("GET", path, { headers: BEARER });

    expect(app.calls.scopeIds).not.toContain(OTHER_CHANNEL);
    expect(reply.status).not.toBe(200);
  });

  test.each([
    ["HEAD on a GET route", "HEAD"],
    ["a method the path does not serve", "PUT"],
    ["OPTIONS", "OPTIONS"],
  ])("%s answers the path's 404 in the api's format", async (_case, method) => {
    const reply = await send(method, `/v1/channels/${CHANNEL}/tasks/${TASK}`, { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(reply.headers.allow).toBeUndefined();
    expect(app.calls.handled).toEqual([]);
  });

  test.each([
    ["a trailing slash", `/v1/channels/${CHANNEL}/tasks/${TASK}/`],
    ["an upper-case path", `/V1/channels/${CHANNEL}/tasks/${TASK}`],
  ])("%s is no contract path, so the app answers it", async (_case, path) => {
    const reply = await send("GET", path, { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(reply.headers["content-type"] ?? "").not.toContain(PROBLEM_MEDIA);
    expect(app.calls.handled).toEqual([]);
  });

  test("a router mounted under a path answers 500 with a log naming the mount", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reply = await send("GET", "/mounted/v1/health");

    expect(reply.status).toBe(500);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("mounted under '/mounted'"));
  });

  test("an app middleware's 401 before the router is rendered by the exported error middleware", async () => {
    const reply = await send("GET", "/v1/me/preferences", {
      headers: { [app.FAIL_BEFORE_HEADER]: "401" },
    });

    expect(reply.status).toBe(401);
    expect(JSON.parse(reply.text)).toMatchObject({ code: "api.unauthenticated" });
  });

  test("the same 401 on an app route is the app's own", async () => {
    const reply = await send("GET", "/own/boom", { headers: { [app.FAIL_BEFORE_HEADER]: "401" } });

    expect(reply.status).toBe(401);
    expect(reply.headers["content-type"] ?? "").not.toContain(PROBLEM_MEDIA);
  });

  test("the app's own routes keep Express's behaviour", async () => {
    const boom = await send("GET", "/own/boom");
    const echo = await send("POST", "/own/echo", { body: JSON.stringify({ a: 1 }) });

    expect(boom.status).toBe(500);
    expect(app.calls.loggedErrors.join("\n")).toContain("own boom");
    expect(echo.headers.etag).toMatch(/^W\//);
  });

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
      body: JSON.stringify({ title: "", effort: -1, extra: true }),
    });

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.text).issues).toEqual(
      expect.arrayContaining([
        { pointer: "/title", rule: "minLength" },
        { pointer: "/extra", rule: "unknownKeys" },
      ]),
    );
  });

  test("the boot check lists a missing handler and an unknown override at once", async () => {
    const generated: RouterModule = await import(
      pathToFileURL(join(build, "generated/server/tasks/express.js")).href
    );
    const { TasksEndpoints: _omitted, ...handlers } = app.handlers;

    expect(() =>
      generated.router({ handlers, hooks: app.hooks, operations: { nothing: {} } }),
    ).toThrow(/TasksEndpoints[\s\S]*'operations' names 'nothing'/);
  });
});

// Points the project's `express` at the major under test; the generated tree and the app resolve it from there.
function linkExpress(project: string, expressPackage: string): void {
  const link = join(project, "node_modules", "express");

  rmSync(link, { recursive: true, force: true });
  symlinkSync(
    fileURLToPath(new URL(`../node_modules/${expressPackage}`, import.meta.url)),
    link,
    "dir",
  );
}
