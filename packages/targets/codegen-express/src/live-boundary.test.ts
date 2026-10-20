import { randomUUID } from "node:crypto";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  besideTasksOnSharedBasePaths,
  copyTestApp,
  emitProject,
  generateReferenceProject,
  problemBody,
  projectDirectory,
  type RawReply,
  type ReferenceIrChange,
  referenceChanges,
  referenceErrorTitle,
  referenceNoStoreCode,
  referenceNoStoreOperation,
  referenceUnpagedList,
  sendRawRequest,
} from "@seampact/codegen-core/node-server/test-support";
import type { ContractIR } from "@seampact/spec/ir";
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
const TASK_ITEM = {
  taskId: TASK,
  title: "Write the slice test",
  state: "open",
  version: 1,
  createdAt: "2026-10-18T09:00:00.000Z",
};
const TOO_LARGE_BODY_BYTES = 1_048_577;
// The code of a body over its limit, marked as a code whose params carry a sensitive value.
const NO_STORE_CODE = "api.payload_too_large";
// A code given a written title; every other code of the reference api declares none.
const TITLED_CODE = "api.unauthenticated";
const WRITTEN_TITLE = "Sign in first.";

interface ReferenceAppModule {
  readonly ALLOWED_ORIGIN: string;
  readonly FAIL_BEFORE_HEADER: string;
  readonly APP_RENDERED_ERROR: string;
  readonly mountedRouterUnexpected: unknown[];
  readonly nestedRouterUnexpected: unknown[];
  readonly calls: {
    readonly scopeIds: unknown[];
    readonly handled: string[];
    readonly unexpected: unknown[];
    readonly loggedErrors: string[];
  };
  readonly scenario: {
    answers: Record<string, (input: unknown) => unknown>;
    authenticate: (request: unknown) => unknown;
    decide: (request: {
      name: string;
      proof?: unknown;
      purpose: { direction?: string };
    }) => unknown;
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
  startTwoApiApp(): Promise<{ host: string; port: number; close(): Promise<void> }>;
  startNestedRouterApp(): Promise<{ host: string; port: number; close(): Promise<void> }>;
  startRouterlessApp(): Promise<{ host: string; port: number; close(): Promise<void> }>;
}

// The message of a reported exception, whether the hook recorded it alone or with its context.
function reportedMessage(entry: unknown): string | undefined {
  const reported =
    typeof entry === "object" && entry !== null && "exceptionOrReply" in entry
      ? entry.exceptionOrReply
      : entry;

  return reported instanceof Error ? reported.message : undefined;
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
    const files = await generateReferenceProject(
      project,
      expressTarget,
      { bodyValidation: true },
      referenceChanges(
        referenceNoStoreCode(NO_STORE_CODE),
        referenceErrorTitle(TITLED_CODE, WRITTEN_TITLE),
        referenceNoStoreOperation("getPreferences"),
        referenceUnpagedList("listChannels"),
      ),
    );

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

  test("an error code marked noStore answers Cache-Control: no-store, another code none", async () => {
    const path = `/v1/channels/${CHANNEL}/tasks`;
    const malformed = await send("POST", path, { headers: writeHeaders(), body: "{" });
    const tooLarge = await send("POST", path, {
      headers: writeHeaders(),
      body: JSON.stringify({ title: "x".repeat(TOO_LARGE_BODY_BYTES) }),
    });

    expect(tooLarge.status).toBe(413);
    expect(tooLarge.headers["cache-control"]).toBe("no-store");
    expect(malformed.status).toBe(400);
    expect(malformed.headers["cache-control"]).toBeUndefined();
  });

  test("a declared noStore code the handler answers carries Cache-Control: no-store", async () => {
    app.scenario.answers.createTask = () => ({ status: 413, code: NO_STORE_CODE });

    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: writeHeaders(),
      body: JSON.stringify({ title: "Plan" }),
    });

    expect(reply.status).toBe(413);
    expect(reply.headers["cache-control"]).toBe("no-store");
  });

  test("an app-written noStore error reply without Cache-Control: no-store is replaced by a 500", async () => {
    app.scenario.answers.createTask = () => {
      throw new app.AppReply(413, PROBLEM_MEDIA, problemBody(NO_STORE_CODE, 413));
    };

    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: writeHeaders(),
      body: JSON.stringify({ title: "Plan" }),
    });

    expect(reply.status).toBe(500);
    expect(app.calls.unexpected).toHaveLength(1);
  });

  test("an app-written success reply of a noStore operation without no-store is replaced by a 500", async () => {
    app.scenario.answers.getPreferences = () => {
      throw new app.AppReply(200, "application/json", JSON.stringify({ locale: "en" }));
    };

    const reply = await send("GET", "/v1/me/preferences", { headers: BEARER });

    expect(reply.status).toBe(500);
    expect(app.calls.unexpected).toHaveLength(1);
  });

  test.each([
    [200, "keyed by its items' ids", { [TASK]: TASK_ITEM }],
    [500, "that is an array", [TASK_ITEM]],
    [500, "keyed by something other than its items' ids", { [OTHER_CHANNEL]: TASK_ITEM }],
  ])("answers %i to an app-written batch read %s", async (status, _case, table) => {
    app.scenario.answers.getTasksBatch = () => {
      throw new app.AppReply(200, "application/json", JSON.stringify(table));
    };

    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks/batch`, {
      headers: BEARER,
      body: JSON.stringify({ ids: [TASK] }),
    });

    expect(reply.status).toBe(status);
    expect(app.calls.unexpected).toHaveLength(status === 200 ? 0 : 1);
  });

  test("a corrupt gzip body is the client's 400, not a server failure", async () => {
    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: { ...writeHeaders(), "content-encoding": "gzip" },
      body: Buffer.from("not gzip"),
    });

    expect(reply.status).toBe(400);
    expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
    expect(app.calls.unexpected).toEqual([]);
    expect(app.calls.handled).toEqual([]);
  });

  test("an empty JSON body is no body, so a required body answers 400 required", async () => {
    const reply = await send("PATCH", "/v1/me/preferences", {
      headers: { ...writeHeaders(), "content-length": "0" },
      body: "",
    });

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.text).issues).toEqual([{ pointer: "", rule: "required" }]);
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

  test.each(["DELETE", "OPTIONS"])(
    "%s on a path that declares no 404 answers a bare 404, not a failure",
    async (method) => {
      const reply = await send(method, "/v1/health");

      expect(reply.status).toBe(404);
      expect(reply.text).toBe("");
      expect(app.calls.unexpected).toEqual([]);
    },
  );

  test("HEAD runs the GET operation and answers its status and headers without a body", async () => {
    const reply = await send("HEAD", `/v1/channels/${CHANNEL}/tasks/${TASK}`, { headers: BEARER });

    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toContain("application/json");
    expect(reply.text).toBe("");
    expect(app.calls.handled).toEqual(["getTask"]);
  });

  test.each([
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
    ["a doubled slash", `/v1//channels/${CHANNEL}/tasks/${TASK}`],
    ["a percent-encoded static segment", `/v1/%63hannels/${CHANNEL}/tasks/${TASK}`],
    ["an unknown sub-path", "/v1/unknown"],
  ])("%s under the base path answers the api's 404", async (_case, path) => {
    const reply = await send("GET", path, { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
    expect(JSON.parse(reply.text)).toMatchObject({ code: "api.not_found" });
    expect(app.calls.handled).toEqual([]);
  });

  test("a code without a written title sends no title member", async () => {
    const reply = await send("GET", "/v1/unknown", { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(JSON.parse(reply.text)).not.toHaveProperty("title");
  });

  test("a code with a written title sends it", async () => {
    const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`);

    expect(reply.status).toBe(401);
    expect(JSON.parse(reply.text)).toMatchObject({ code: TITLED_CODE, title: WRITTEN_TITLE });
  });

  test("a path outside the base path, as an upper-case one, is the app's 404", async () => {
    const reply = await send("GET", `/V1/channels/${CHANNEL}/tasks/${TASK}`, { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(reply.headers["content-type"] ?? "").not.toContain(PROBLEM_MEDIA);
    expect(app.calls.handled).toEqual([]);
  });

  test("a +json media type on a JSON route answers 415", async () => {
    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: { ...writeHeaders(), "content-type": "application/merge-patch+json" },
      body: JSON.stringify({ title: "Plan" }),
    });

    expect(reply.status).toBe(415);
    expect(app.calls.handled).toEqual([]);
  });

  test("a router mounted under a path answers 500 with a log naming the mount", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reply = await send("GET", "/mounted/v1/health");

    expect(reply.status).toBe(500);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("mounted under '/mounted'"));
  });

  test("a request under the mount that no route of the router serves answers 500 with the same log, not the app's 404", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reply = await send("GET", "/mounted/health");

    expect(reply.status).toBe(500);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("mounted under '/mounted'"));
  });

  test("an error rendered outside a request context reports to the router that serves the app, not the last made", async () => {
    const reply = await send("GET", "/own/render-error");

    expect(reply.status).toBe(500);
    expect(app.calls.unexpected.map(reportedMessage)).toEqual([app.APP_RENDERED_ERROR]);
    expect(app.mountedRouterUnexpected.map(reportedMessage)).not.toContain(app.APP_RENDERED_ERROR);
  });

  describe("with the router nested in a parent router", () => {
    let nestedServer: Awaited<ReturnType<ReferenceAppModule["startNestedRouterApp"]>>;
    const unhandled: unknown[] = [];
    const recordUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };

    beforeAll(async () => {
      nestedServer = await app.startNestedRouterApp();
      process.on("unhandledRejection", recordUnhandled);
    });

    afterAll(async () => {
      process.off("unhandledRejection", recordUnhandled);
      await nestedServer?.close();
    });

    beforeEach(() => {
      unhandled.length = 0;
      app.nestedRouterUnexpected.length = 0;
    });

    test("an app middleware's 401 before the router answers in the api's format", async () => {
      const reply = await sendRawRequest(nestedServer, "GET", "/v1/me/preferences", {
        headers: { [app.FAIL_BEFORE_HEADER]: "401" },
      });

      expect(reply.status).toBe(401);
      expect(JSON.parse(reply.text)).toMatchObject({ code: "api.unauthenticated" });
    });

    test("an app body parser's 413 before the router answers in the api's format", async () => {
      const reply = await sendRawRequest(nestedServer, "POST", `/v1/channels/${CHANNEL}/tasks`, {
        headers: writeHeaders(),
        body: JSON.stringify({ title: "x".repeat(TOO_LARGE_BODY_BYTES) }),
      });

      expect(reply.status).toBe(413);
      expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
    });

    test("an error an app route renders without awaiting it reports to the nested router", async () => {
      const reply = await sendRawRequest(nestedServer, "GET", "/own/render-error");

      await new Promise((resolve) => setImmediate(resolve));

      expect(reply.status).toBe(500);
      expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
      expect(app.nestedRouterUnexpected.map(reportedMessage)).toEqual([app.APP_RENDERED_ERROR]);
      expect(unhandled).toEqual([]);
    });
  });

  test("an error rendered by an app with none of the api's routers answers in its format and says why", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const routerless = await app.startRouterlessApp();

    try {
      const reply = await sendRawRequest(routerless, "GET", "/own/render-error");

      expect(reply.status).toBe(500);
      expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("is reachable from the app"));
    } finally {
      await routerless.close();
    }
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

  test.each([
    ["a member off its schema", { userId: 42, admin: true }],
    ["a string", "root"],
  ])("a principal that is %s answers 500 and reaches no handler", async (_case, principal) => {
    app.scenario.authenticate = () => ({ principal });

    const reply = await send("GET", `/v1/channels/${CHANNEL}`, { headers: BEARER });

    expect(reply.status).toBe(500);
    expect(app.calls.unexpected).toEqual([
      expect.objectContaining({
        exceptionOrReply: expect.objectContaining({
          message: expect.stringContaining("does not match its schema 'UserPrincipal'"),
        }),
      }),
    ]);
    expect(app.calls.handled).toEqual([]);
  });

  test("a scope id off its schema answers 400 before the resolver sees it", async () => {
    const reply = await send("GET", "/v1/channels/x'%20OR%201=1--", { headers: BEARER });

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.text).issues).toEqual([{ pointer: "/channelId", rule: "format" }]);
    expect(app.calls.scopeIds).toEqual([]);
  });

  test("a subject id off its schema answers 400 before the decider sees it", async () => {
    const decided: string[] = [];

    app.scenario.decide = (request) => {
      decided.push(request.name);

      return { allow: true };
    };

    const reply = await send("PATCH", `/v1/channels/${CHANNEL}/tasks/x'%20OR%201=1--`, {
      headers: writeHeaders(),
      body: JSON.stringify({ title: "Plan" }),
    });

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.text).issues).toEqual([{ pointer: "/taskId", rule: "format" }]);
    expect(decided).toEqual([]);
  });

  test("a body proof off its field schema answers 400 before the decider sees it", async () => {
    const proofs: unknown[] = [];

    app.scenario.decide = (request) => {
      proofs.push(request.proof);

      return { allow: true };
    };

    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks/${TASK}/purge`, {
      headers: writeHeaders(),
      body: JSON.stringify({ reauthToken: { $ne: null } }),
    });

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.text).issues).toEqual([{ pointer: "/reauthToken", rule: "type" }]);
    expect(proofs).toEqual([]);
  });

  test("a valid body proof reaches the decider", async () => {
    const proofs: unknown[] = [];

    app.scenario.answers.purgeTask = () => ({ status: 204 });
    app.scenario.decide = (request) => {
      proofs.push(request.proof);

      return { allow: true };
    };

    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks/${TASK}/purge`, {
      headers: writeHeaders(),
      body: JSON.stringify({ reauthToken: "token" }),
    });

    expect(reply.status).toBe(204);
    expect(proofs).toEqual(["token"]);
  });

  test("a list declared paging none answers a bare array, and refuses a cursor it never declared", async () => {
    app.scenario.answers.listChannels = () => ({ status: 200, body: [{ channelId: CHANNEL }] });

    const reply = await send("GET", "/v1/channels", { headers: BEARER });
    const withCursor = await send("GET", "/v1/channels?cursor=a", { headers: BEARER });

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toEqual([{ channelId: CHANNEL }]);
    expect(reply.headers.link).toBeUndefined();
    expect(withCursor.status).toBe(400);
  });

  test("a repeated text query key answers 400 rather than keeping one value", async () => {
    const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks?cursor=a&cursor=b`, {
      headers: BEARER,
    });

    expect(reply.status).toBe(400);
    expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
    expect(JSON.parse(reply.text).issues).toEqual([{ pointer: "/cursor", rule: "type" }]);
    expect(app.calls.handled).toEqual([]);
  });

  test("a sort key the operation does not declare answers 400, a declared one passes", async () => {
    app.scenario.answers.listTasks = () => ({ status: 200, body: { items: [] } });

    const unknown = await send("GET", `/v1/channels/${CHANNEL}/tasks?sort=-createdAt,title`, {
      headers: BEARER,
    });
    const declared = await send("GET", `/v1/channels/${CHANNEL}/tasks?sort=-createdAt,createdAt`, {
      headers: BEARER,
    });

    expect(unknown.status).toBe(400);
    expect(JSON.parse(unknown.text).issues).toEqual([{ pointer: "/sort/1", rule: "pattern" }]);
    expect(declared.status).toBe(200);
    expect(app.calls.handled).toEqual(["listTasks"]);
  });

  test("the same key on an equivalently encoded path replays the first reply", async () => {
    const headers = writeHeaders();
    const body = JSON.stringify({ title: "Plan" });
    const first = await send("POST", `/v1/channels/${CHANNEL}/tasks`, { headers, body });
    const encodedChannel = CHANNEL.replaceAll("-", "%2D");
    const second = await send("POST", `/v1/channels/${encodedChannel}/tasks`, { headers, body });

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.text).toBe(first.text);
    expect(app.calls.handled).toEqual(["createTask"]);
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

  test("an app whose router stack the router cannot read is refused by name", async () => {
    const generated: RouterModule = await import(
      pathToFileURL(join(build, "generated/server/tasks/express.js")).href
    );
    const contractRouter = generated.router({ handlers: app.handlers, hooks: app.hooks });
    const stubApp = {};
    const stubRequest = {
      method: "GET",
      url: "/v1/unknown",
      originalUrl: "/v1/unknown",
      headers: {},
      app: stubApp,
    };

    expect(contractRouter).toBeTypeOf("function");

    const refusal = await new Promise<unknown>((resolve) => {
      if (typeof contractRouter === "function") {
        Reflect.apply(contractRouter, undefined, [stubRequest, {}, resolve]);
      }
    });

    expect(String(refusal)).toMatch(/api 'tasks' cannot read the router stack of the app/);
  });
});

describe.each(EXPRESS_MAJORS)("two apis on one base path on %s", (_major, expressPackage) => {
  const project = projectDirectory(import.meta.url, `live-two-apis-${expressPackage}`);
  let app: ReferenceAppModule;
  let server: Awaited<ReturnType<ReferenceAppModule["startTwoApiApp"]>>;

  beforeAll(async () => {
    const files = await generateReferenceProject(
      project,
      expressTarget,
      {},
      besideTasksOnSharedBasePaths,
    );
    const build = join(project, "build");

    expect(emitProject(project, files, build)).toEqual([]);
    linkExpress(project, expressPackage);
    app = await import(copyTestApp(build, APP_SOURCE));
    server = await app.startTwoApiApp();
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await server?.close();
  });

  beforeEach(() => {
    app.resetScenario();
  });

  test.each([
    ["the first router", `/v1/channels/${CHANNEL}/tasks/${TASK}`],
    ["the router mounted after it", `/v1/beside/channels/${CHANNEL}/tasks/${TASK}`],
  ])("%s serves its own routes", async (_router, path) => {
    const reply = await sendRawRequest(server, "GET", path, { headers: BEARER });

    expect(reply.status).toBe(200);
    expect(app.calls.handled).toEqual(["getTask"]);
  });

  test.each(["/v1/unknown", "/v1/hooks/unknown"])(
    "%s, under a base path both apis claim, is the app's own 404",
    async (path) => {
      const reply = await sendRawRequest(server, "GET", path, { headers: BEARER });

      expect(reply.status).toBe(404);
      expect(reply.headers["content-type"] ?? "").not.toContain(PROBLEM_MEDIA);
    },
  );

  test("a path under a base path one api claims alone answers that api's notFound code", async () => {
    const reply = await sendRawRequest(server, "GET", "/beside/unknown", { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
    expect(JSON.parse(reply.text)).toMatchObject({ code: "api.not_found" });
  });
});

const PROOF_RULE = "recentAuth";
const PROOF_LIST: ContractIR["rules"][string]["proof"] = {
  in: "body",
  name: "reauthToken",
  schema: { kind: "array", items: { kind: "scalar", type: "string", refinements: {} } },
};

// The `tasks` contract with the purge route's body proof as a list of texts, a value a decider could change.
const listProof: ReferenceIrChange = (ir, api) => {
  const rule = ir.rules[PROOF_RULE];

  if (api !== "tasks" || rule === undefined || PROOF_LIST === undefined) return ir;

  return {
    ...ir,
    rules: { ...ir.rules, [PROOF_RULE]: { ...rule, proof: PROOF_LIST } },
    operations: ir.operations.map((operation) =>
      operation.input?.proofs === undefined
        ? operation
        : {
            ...operation,
            input: {
              ...operation.input,
              proofs: operation.input.proofs.map((proof) => ({
                ...proof,
                schema: PROOF_LIST.schema,
              })),
            },
          },
    ),
  };
};

describe("a body proof a decider changes on Express 5", () => {
  const project = projectDirectory(import.meta.url, "live-list-proof");
  let app: ReferenceAppModule;
  let server: Awaited<ReturnType<ReferenceAppModule["startReferenceApp"]>>;

  beforeAll(async () => {
    const files = await generateReferenceProject(project, expressTarget, {}, listProof);
    const build = join(project, "build");

    expect(emitProject(project, files, build)).toEqual([]);
    linkExpress(project, "express");
    app = await import(copyTestApp(build, APP_SOURCE));
    server = await app.startReferenceApp();
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await server?.close();
  });

  test("reaches the handler as the client sent it", async () => {
    const handledProofs: unknown[] = [];

    app.resetScenario();
    app.scenario.decide = (request) => {
      if (Array.isArray(request.proof)) request.proof.push("changed by the decider");

      return { allow: true };
    };

    app.scenario.answers.purgeTask = (input) => {
      handledProofs.push(Reflect.get(Reflect.get(Object(input), "body") ?? {}, "reauthToken"));

      return { status: 204 };
    };

    const reply = await sendRawRequest(
      server,
      "POST",
      `/v1/channels/${CHANNEL}/tasks/${TASK}/purge`,
      {
        headers: writeHeaders(),
        body: JSON.stringify({ reauthToken: ["token"] }),
      },
    );

    expect(reply.status).toBe(204);
    expect(handledProofs).toEqual([["token"]]);
  });
});

interface UncheckedAppModule {
  readonly UNLISTED_OWN_ROUTE: string;
  startUncheckedApp(options: {
    withUnlistedRoute: boolean;
  }): Promise<{ host: string; port: number; close(): Promise<void> }>;
  startUncheckedSubApp(): Promise<{ host: string; port: number; close(): Promise<void> }>;
  checkAppWithOwnRoute(ownPath: string): void;
}

// A catch-all below the contract route `GET /v1/channels/{channelId}/tasks/{taskId}`, as each major writes it.
const CATCH_ALL_UNDER_TASKS: Readonly<Record<(typeof EXPRESS_MAJORS)[number][1], string>> = {
  express: "/v1/channels/:channelId/tasks/*rest",
  express4: "/v1/channels/:channelId/tasks/*",
};

describe.each(EXPRESS_MAJORS)(
  "the framework-route check of an app on %s",
  (_major, expressPackage) => {
    const project = projectDirectory(import.meta.url, `live-unchecked-${expressPackage}`);
    const path = `/v1/channels/${CHANNEL}/tasks/${TASK}`;
    let uncheckedModule: UncheckedAppModule;

    beforeAll(async () => {
      const files = await generateReferenceProject(project, expressTarget, {}, undefined, {
        status: "on",
        allowed: [{ path: "/own/listed", reason: "the test app's own route" }],
      });
      const build = join(project, "build");

      expect(emitProject(project, files, build)).toEqual([]);
      linkExpress(project, expressPackage);
      uncheckedModule = await import(copyTestApp(build, APP_SOURCE));
    }, SETUP_TIMEOUT_MILLISECONDS);

    test("an app that never runs the check gives 500 on every request for an unlisted route, logged", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const unchecked = await uncheckedModule.startUncheckedApp({ withUnlistedRoute: true });

      try {
        for (const attempt of [1, 2]) {
          const refused = await sendRawRequest(unchecked, "GET", path, { headers: BEARER });

          expect(refused.status, `attempt ${attempt}`).toBe(500);
          expect(refused.headers["content-type"]).toContain(PROBLEM_MEDIA);
        }

        expect(logged).toHaveBeenCalledTimes(2);
        expect(logged).toHaveBeenCalledWith(
          expect.stringContaining(`GET ${uncheckedModule.UNLISTED_OWN_ROUTE}`),
        );
      } finally {
        logged.mockRestore();
        await unchecked.close();
      }
    });

    test("a mounted sub-app's router checks the root app: its unlisted route gives 500", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const unchecked = await uncheckedModule.startUncheckedSubApp();

      try {
        const refused = await sendRawRequest(unchecked, "GET", path, { headers: BEARER });

        expect(refused.status).toBe(500);
        expect(logged).toHaveBeenCalledOnce();
      } finally {
        logged.mockRestore();
        await unchecked.close();
      }
    });

    test("an app route at a contract path, outside the generated router, is refused", () => {
      const ownPath = "/v1/channels/:channelId/tasks/:taskId";

      expect(() => uncheckedModule.checkAppWithOwnRoute(ownPath)).toThrow(`'GET ${ownPath}'`);
    });

    test("an app catch-all under a contract param path is refused", () => {
      const ownPath = CATCH_ALL_UNDER_TASKS[expressPackage];

      expect(() => uncheckedModule.checkAppWithOwnRoute(ownPath)).toThrow(`'GET ${ownPath}'`);
    });

    test("an app that never runs the check serves normally when its own routes are allow-listed", async () => {
      const clean = await uncheckedModule.startUncheckedApp({ withUnlistedRoute: false });

      try {
        const reply = await sendRawRequest(clean, "GET", path, { headers: BEARER });

        expect(reply.status).toBe(200);
      } finally {
        await clean.close();
      }
    });
  },
);

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

interface HooklessAppModule {
  startAppWithoutHooks(): Promise<{ host: string; port: number; close(): Promise<void> }>;
  makeRouterWithoutHooks(logger?: {
    warn(...parts: unknown[]): void;
    error(...parts: unknown[]): void;
  }): unknown;
}

describe("the hook boot check level on Express 5", () => {
  const expressPackage = "express";
  const path = `/v1/channels/${CHANNEL}/tasks/${TASK}`;

  async function hooklessModule(hookCheck?: "off" | "warn"): Promise<HooklessAppModule> {
    const project = projectDirectory(import.meta.url, `live-hookless-${hookCheck ?? "error"}`);
    const files = await generateReferenceProject(
      project,
      expressTarget,
      {},
      undefined,
      undefined,
      hookCheck === undefined ? {} : { hookCheck },
    );
    const build = join(project, "build");

    expect(emitProject(project, files, build)).toEqual([]);
    linkExpress(project, expressPackage);

    return import(copyTestApp(build, APP_SOURCE));
  }

  test(
    "by default an api with no hook registered refuses to boot",
    async () => {
      const hookless = await hooklessModule();

      expect(() => hookless.makeRouterWithoutHooks()).toThrow(/no authenticate hook/);
    },
    SETUP_TIMEOUT_MILLISECONDS,
  );

  test(
    "hooks warn boots it and logs the missing hook through the registered logger",
    async () => {
      const hookless = await hooklessModule("warn");
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const logger = { warn: vi.fn(), error: vi.fn() };

      try {
        expect(() => hookless.makeRouterWithoutHooks(logger)).not.toThrow();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("no authenticate hook"));
        expect(consoleWarn).not.toHaveBeenCalled();
      } finally {
        consoleWarn.mockRestore();
      }
    },
    SETUP_TIMEOUT_MILLISECONDS,
  );

  test(
    "hooks off boots it, and a protected route answers 500 at request time",
    async () => {
      const hookless = await hooklessModule("off");
      const app = await hookless.startAppWithoutHooks();
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const refused = await sendRawRequest(app, "GET", path, { headers: BEARER });

        expect(refused.status).toBe(500);
      } finally {
        logged.mockRestore();
        await app.close();
      }
    },
    SETUP_TIMEOUT_MILLISECONDS,
  );
});

describe("the frameworkEtag option on Express 5", () => {
  const project = projectDirectory(import.meta.url, "live-framework-etag");
  let app: ReferenceAppModule;
  let server: Awaited<ReturnType<ReferenceAppModule["startReferenceApp"]>>;

  beforeAll(async () => {
    const files = await generateReferenceProject(project, expressTarget, {
      frameworkEtag: "keep",
    });
    const build = join(project, "build");

    expect(emitProject(project, files, build)).toEqual([]);
    linkExpress(project, "express");
    app = await import(copyTestApp(build, APP_SOURCE));
    server = await app.startReferenceApp();
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await server?.close();
  });

  test("keep leaves the ETag an app writes on a reply the boundary did not write", async () => {
    app.resetScenario();
    app.scenario.answers.getTask = () => {
      throw new app.AppReply(404, PROBLEM_MEDIA, problemBody("api.not_found", 404), "writeHead");
    };

    const reply = await sendRawRequest(server, "GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, {
      headers: BEARER,
    });

    expect(reply.status).toBe(404);
    expect(reply.headers.etag).toBe('"app-etag"');
  });
});

describe("the catchAll option on Express 5", () => {
  const project = projectDirectory(import.meta.url, "live-catch-all");
  let app: ReferenceAppModule;
  let server: Awaited<ReturnType<ReferenceAppModule["startReferenceApp"]>>;

  beforeAll(async () => {
    const files = await generateReferenceProject(project, expressTarget, { catchAll: false });
    const build = join(project, "build");

    expect(emitProject(project, files, build)).toEqual([]);
    linkExpress(project, "express");
    app = await import(copyTestApp(build, APP_SOURCE));
    server = await app.startReferenceApp();
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await server?.close();
  });

  test("false leaves an unknown path under the base path to the app, not the api's 404", async () => {
    app.resetScenario();

    const reply = await sendRawRequest(server, "GET", "/v1/unknown", { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(reply.headers["content-type"] ?? "").not.toContain(PROBLEM_MEDIA);
  });
});
