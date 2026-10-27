import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  besideTasksOnSharedBasePaths,
  CLIENT_ADDRESS_CASES,
  clientAddressesTheHookSees,
  copyTestApp,
  describeDebugExceptions,
  describeHandlerAccess,
  describeTwoApiHandlerAccess,
  emitProject,
  generateReferenceProject,
  problemBody,
  projectDirectory,
  type RawReply,
  type ReferenceIrChange,
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
const BASE_PATH = "/v1";

interface ReferenceAppModule {
  readonly ALLOWED_ORIGIN: string;
  readonly THROTTLE_RETRY_AFTER_HEADER: string;
  readonly FAIL_BEFORE_HEADER: string;
  readonly calls: {
    readonly handled: string[];
    readonly unexpected: unknown[];
    readonly loggedErrors: string[];
  };
  readonly scenario: {
    answers: Record<string, (input: unknown) => unknown>;
    authenticate: (request: unknown) => unknown;
    resolvedScopeName: string;
    trustsProxy: boolean;
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
  bootWith(registration: object, instanceOptions?: object, prefix?: string): Promise<void>;
  bootTwice(registration: object): Promise<void>;
  collectAfterOwnRoute(): Promise<void>;
  startReferenceApp(): Promise<{ host: string; port: number; close(): Promise<void> }>;
  startPrefixedApp(prefix: string): Promise<{ host: string; port: number; close(): Promise<void> }>;
  startTwoApiApp(): Promise<{ host: string; port: number; close(): Promise<void> }>;
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

describe("what a handler reads of its caller", () => {
  describeHandlerAccess(() => ({
    app,
    send: (method, path, headers) => send(method, path, { headers }),
  }));

  describeDebugExceptions(() => ({
    app,
    send: (method, path, headers) => send(method, path, { headers }),
  }));
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

  test("a framework 429 after a throttler's Retry-After answers the rateLimited code with its delay", async () => {
    app.scenario.answers.createTask = () => {
      throw Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 });
    };

    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: { ...writeHeaders(), [app.THROTTLE_RETRY_AFTER_HEADER]: "2" },
      body: JSON.stringify({ title: "Plan" }),
    });

    expect(reply.status).toBe(429);
    expect(JSON.parse(reply.text)).toMatchObject({ code: "api.rate_limited" });
    expect(reply.text).toContain('"retryAfterMs":2000');
    expect(reply.headers["retry-after"]).toBe("2");
  });

  test("a framework 429 whose rateLimited code requires params is a reported 500", async () => {
    app.scenario.answers.createTask = () => {
      throw Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 });
    };

    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: writeHeaders(),
      body: JSON.stringify({ title: "Plan" }),
    });

    expect(reply.status).toBe(500);
    expect(app.calls.unexpected).toEqual([
      expect.objectContaining({
        exceptionOrReply: expect.objectContaining({
          message: expect.stringContaining(
            "maps to 'api.rate_limited', which declares required params",
          ),
        }),
      }),
    ]);
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
    expect(app.calls.handled).toEqual([]);
    expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
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

  test("a path outside the base path, as an upper-case one, is the app's own 404", async () => {
    const reply = await send("GET", `/V1/channels/${CHANNEL}/tasks/${TASK}`, { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(reply.headers["content-type"] ?? "").not.toContain(PROBLEM_MEDIA);
  });

  test("a +json media type on a JSON route answers 415", async () => {
    const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
      headers: { ...writeHeaders(), "content-type": "application/merge-patch+json" },
      body: JSON.stringify({ title: "Plan" }),
    });

    expect(reply.status).toBe(415);
    expect(app.calls.handled).toEqual([]);
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
  test.each(CLIENT_ADDRESS_CASES)(
    "behind $proxy the hooks see the client address the framework resolves",
    async ({ trustsProxy, address }) => {
      const { reply, seen } = await clientAddressesTheHookSees(
        app.scenario,
        trustsProxy,
        (forwarded) =>
          send("GET", `/v1/channels/${CHANNEL}`, { headers: { ...BEARER, ...forwarded } }),
      );

      expect(reply.status).toBe(200);
      expect(seen).toEqual([expect.stringMatching(address)]);
    },
  );

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
  test("refuses a framework-route collector installed once the app holds a route", async () => {
    await expect(app.collectAfterOwnRoute()).rejects.toThrow(
      "call collectFrameworkRoutes(app) right after Fastify() creates the app, before any route",
    );
  });

  test("lists a missing handler, an unknown override and a prefix at once", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { TasksEndpoints: _omitted, ...handlers } = app.handlers;

    await expect(
      app.bootWith({ handlers, hooks: app.hooks, operations: { nothing: {} } }, {}, "/api"),
    ).rejects.toThrow(
      /TasksEndpoints[\s\S]*'operations' names 'nothing'[\s\S]*prefix '\/api'[\s\S]*under the prefix '\/v1'/,
    );
  });

  test("a prefix equal to the contract's base path boots", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      app.bootWith({ handlers: app.handlers, hooks: app.hooks }, {}, "/v1"),
    ).resolves.toBeUndefined();
  });

  test("an instance without HEAD routes stops the boot", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      app.bootWith({ handlers: app.handlers, hooks: app.hooks }, { exposeHeadRoutes: false }),
    ).rejects.toThrow(/exposeHeadRoutes/);
  });

  test("a second registration of the api in one app stops the boot", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(app.bootTwice({ handlers: app.handlers, hooks: app.hooks })).rejects.toThrow(
      /registered twice/,
    );
  });
});

const HEALTH_OPERATION = "health";

// The health route moved to the base path itself, the path a registration prefix equal to it leaves as `/`.
const healthAtBasePath: ReferenceIrChange = (ir, api) =>
  api === "tasks"
    ? {
        ...ir,
        operations: ir.operations.map((operation) =>
          operation.id === HEALTH_OPERATION ? { ...operation, path: BASE_PATH } : operation,
        ),
      }
    : ir;

describe("a route at the base path under a prefix equal to it", () => {
  const project = projectDirectory(import.meta.url, "live-route-at-prefix");
  let prefixedApp: ReferenceAppModule;
  let prefixedServer: Awaited<ReturnType<ReferenceAppModule["startPrefixedApp"]>>;

  beforeAll(async () => {
    const files = await generateReferenceProject(project, fastifyTarget, {}, healthAtBasePath);
    const build = join(project, "build");

    expect(emitProject(project, files, build)).toEqual([]);
    prefixedApp = await import(copyTestApp(build, APP_SOURCE));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    prefixedServer = await prefixedApp.startPrefixedApp(BASE_PATH);
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await prefixedServer?.close();
  });

  test("serves the base path and leaves its trailing-slash form unserved", async () => {
    const served = await sendRawRequest(prefixedServer, "GET", BASE_PATH);
    const trailingSlash = await sendRawRequest(prefixedServer, "GET", `${BASE_PATH}/`);

    expect(served.status).toBe(200);
    expect(trailingSlash.status).toBe(404);
  });
});

describe("two apis on one base path", () => {
  const project = projectDirectory(import.meta.url, "live-two-apis");
  let twoApiApp: ReferenceAppModule;
  let twoApiServer: Awaited<ReturnType<ReferenceAppModule["startTwoApiApp"]>>;

  beforeAll(async () => {
    const files = await generateReferenceProject(
      project,
      fastifyTarget,
      {},
      besideTasksOnSharedBasePaths,
    );
    const build = join(project, "build");

    expect(emitProject(project, files, build)).toEqual([]);
    twoApiApp = await import(copyTestApp(build, APP_SOURCE));
    twoApiServer = await twoApiApp.startTwoApiApp();
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await twoApiServer?.close();
  });

  beforeEach(() => {
    twoApiApp.resetScenario();
  });

  describeTwoApiHandlerAccess(() => ({
    app: twoApiApp,
    send: (method, path, headers) => sendRawRequest(twoApiServer, method, path, { headers }),
  }));

  test.each([
    ["the first api", `/v1/channels/${CHANNEL}/tasks/${TASK}`],
    ["the second api", `/v1/beside/channels/${CHANNEL}/tasks/${TASK}`],
  ])("%s serves its own routes", async (_api, path) => {
    const reply = await sendRawRequest(twoApiServer, "GET", path, { headers: BEARER });

    expect(reply.status).toBe(200);
    expect(twoApiApp.calls.handled).toEqual(["getTask"]);
  });

  test.each(["/v1/unknown", "/v1/hooks/unknown"])(
    "%s, under a base path both apis claim, is the app's own 404",
    async (path) => {
      const reply = await sendRawRequest(twoApiServer, "GET", path, { headers: BEARER });

      expect(reply.status).toBe(404);
      expect(JSON.parse(reply.text)).toEqual({ message: "not found" });
    },
  );

  test("a path under a base path one api claims alone answers that api's notFound code", async () => {
    const reply = await sendRawRequest(twoApiServer, "GET", "/beside/unknown", { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
    expect(JSON.parse(reply.text)).toMatchObject({ code: "api.not_found" });
  });
});

describe("the catchAll option", () => {
  const project = projectDirectory(import.meta.url, "live-catch-all");
  const PROBLEM_MEDIA = "application/problem+json";
  let catchAllApp: ReferenceAppModule;
  let catchAllServer: Awaited<ReturnType<ReferenceAppModule["startReferenceApp"]>>;

  beforeAll(async () => {
    const files = await generateReferenceProject(project, fastifyTarget, { catchAll: false });
    const build = join(project, "build");

    expect(emitProject(project, files, build)).toEqual([]);
    catchAllApp = await import(copyTestApp(build, APP_SOURCE));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    catchAllServer = await catchAllApp.startReferenceApp();
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await catchAllServer?.close();
  });

  test("false leaves an unknown path under the base path to the app, not the api's 404", async () => {
    catchAllApp.resetScenario();

    const reply = await sendRawRequest(catchAllServer, "GET", "/v1/unknown", { headers: BEARER });

    expect(reply.status).toBe(404);
    expect(reply.headers["content-type"] ?? "").not.toContain(PROBLEM_MEDIA);
  });
});
