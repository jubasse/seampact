import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CLIENT_ADDRESS_CASES,
  clientAddressesTheHookSees,
  emitProject,
  generateReferenceProject,
  problemBody,
  projectDirectory,
  type RawReply,
  sendRawRequest,
} from "@seampact/codegen-core/node-server/test-support";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { target as nestjsTarget } from "./index.js";

// Boots NestJS with Express around the generated `tasks` boundary (the app in `test-app/`) and sends requests to
// it, in both reply modes: the wire behaviour the compile test cannot see.

const REPLY_MODES = ["handler", "interceptor"] as const;
const APP_SOURCE = new URL("../test-app/reference-app.js", import.meta.url);
// Generating and compiling both apis outruns vitest's default 10 s hook limit on a loaded machine.
const SETUP_TIMEOUT_MILLISECONDS = 60_000;

const CHANNEL = "11111111-1111-4111-8111-111111111111";
const OTHER_CHANNEL = "22222222-2222-4222-8222-222222222222";
const TASK = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
const BEARER = { authorization: `Bearer user-${USER}` };
const PROBLEM_MEDIA = "application/problem+json";

function writeHeaders(): Record<string, string> {
  return { ...BEARER, "idempotency-key": randomUUID() };
}

type ReplyMode = (typeof REPLY_MODES)[number];

interface UnexpectedCall {
  readonly exceptionOrReply: unknown;
  readonly context: { readonly operation?: string };
}

interface ReferenceAppModule {
  readonly ALLOWED_ORIGIN: string;
  readonly APP_MARKER: string;
  readonly TasksController: new () => Record<string, (...args: unknown[]) => unknown>;
  readonly calls: {
    readonly scopeIds: unknown[];
    readonly handled: string[];
    readonly unexpected: UnexpectedCall[];
    readonly loggedErrors: string[];
    readonly events: string[];
  };
  readonly scenario: {
    answers: Record<
      string,
      (input: unknown, controller: Record<string, (...args: unknown[]) => unknown>) => unknown
    >;
    authenticate: (request: unknown) => unknown;
    trustsProxy: boolean;
    decide: (request: { name: string; purpose: { direction?: string } }) => unknown;
    interceptor: {
      record?: boolean;
      map?: (value: unknown) => unknown;
      replaceError?: Error;
      failAfter?: boolean;
      answer?: unknown;
      emitTwice?: boolean;
    };
  };
  readonly AppReply: new (
    status: number,
    contentType: string,
    body: string,
    writer?: string,
  ) => Error;
  resetScenario(): void;
  startReferenceApp(): Promise<{
    host: string;
    port: number;
    globalInterceptors: string[];
    close(): Promise<void>;
  }>;
  bootTwice(): Promise<void>;
  bootWithAppInterceptors(): Promise<void>;
  bootWithCacheInterceptor(skipsContractRoutes: boolean): Promise<void>;
  bootWithoutInputParam(): Promise<void>;
  bootWithLateGuard(): Promise<void>;
  bootWithoutGuard(): Promise<void>;
  bootWithRequestScopedInterceptor(): Promise<void>;
  bootWithLateGlobalInterceptor(): Promise<void>;
  bootWithModuleOptions(moduleOptions: unknown): Promise<void>;
}

describe.each(REPLY_MODES)("reply: %s", (reply: ReplyMode) => {
  let app: ReferenceAppModule;
  let server: Awaited<ReturnType<ReferenceAppModule["startReferenceApp"]>>;

  function send(
    method: string,
    path: string,
    options: { headers?: Record<string, string>; body?: string } = {},
  ): Promise<RawReply> {
    return sendRawRequest(server, method, path, options);
  }

  beforeAll(async () => {
    const PROJECT = projectDirectory(import.meta.url, `live-boundary-${reply}`);
    const BUILD = join(PROJECT, "build");
    const files = await generateReferenceProject(PROJECT, nestjsTarget, {
      bodyValidation: true,
      reply,
    });

    expect(emitProject(PROJECT, files, BUILD)).toEqual([]);

    mkdirSync(join(BUILD, "app"), { recursive: true });
    copyFileSync(APP_SOURCE, join(BUILD, "app", "reference-app.js"));
    app = await import(pathToFileURL(join(BUILD, "app", "reference-app.js")).href);
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

  describe("compressed error replies", () => {
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

    test("an error body in an encoding the check cannot read is a violation", async () => {
      app.scenario.answers.getTask = () => {
        throw new app.AppReply(
          404,
          PROBLEM_MEDIA,
          problemBody("api.not_found", 404),
          "encoding:x-custom",
        );
      };

      const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, { headers: BEARER });

      expect(reply.status).toBe(500);
      expect(reply.headers["content-encoding"]).toBeUndefined();
      expect(app.calls.unexpected).toHaveLength(1);
    });
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
    // OPTIONS is left out: the app's CORS answers it.
    test("DELETE on a path that declares no 404 answers a bare 404, not a failure", async () => {
      const reply = await send("DELETE", "/v1/health");

      expect(reply.status).toBe(404);
      expect(reply.text).toBe("");
      expect(app.calls.unexpected).toEqual([]);
    });

    test("HEAD runs the GET operation and answers its status and headers without a body", async () => {
      const reply = await send("HEAD", `/v1/channels/${CHANNEL}/tasks/${TASK}`, {
        headers: BEARER,
      });

      expect(reply.status).toBe(200);
      expect(reply.headers["content-type"]).toContain("application/json");
      expect(reply.text).toBe("");
      expect(app.calls.handled).toEqual(["getTask"]);
    });

    test.each([
      ["a trailing slash", "GET", `/v1/channels/${CHANNEL}/tasks/${TASK}/`],
      ["a doubled slash", "GET", `/v1//channels/${CHANNEL}/tasks/${TASK}`],
      ["a percent-encoded static segment", "GET", `/v1/%63hannels/${CHANNEL}/tasks/${TASK}`],
      ["an unknown sub-path", "GET", "/v1/unknown"],
      ["a method the path does not serve", "PUT", `/v1/channels/${CHANNEL}/tasks/${TASK}`],
    ])("%s under the base path answers the api's 404", async (_case, method, path) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const reply = await send(method, path, { headers: BEARER });

      expect(reply.status).toBe(404);
      expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
      expect(JSON.parse(reply.text)).toMatchObject({ code: "api.not_found" });
      expect(error).not.toHaveBeenCalled();
      expect(app.calls.handled).toEqual([]);
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

    test("an empty JSON body is no body, so a required body answers 400 required", async () => {
      const reply = await send("PATCH", "/v1/me/preferences", {
        headers: { ...writeHeaders(), "content-length": "0" },
        body: "",
      });

      expect(reply.status).toBe(400);
      expect(JSON.parse(reply.text).issues).toEqual([{ pointer: "", rule: "required" }]);
      expect(app.calls.handled).toEqual([]);
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
      expect(JSON.parse(malformed.text).issues).toEqual([
        { pointer: "/channelId", rule: "format" },
      ]);
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

  describe("app pipes and interceptors around the contract checks", () => {
    test("an app pipe on the input param cannot change the validated input", async () => {
      const reply = await send("GET", `/v1/channels/${CHANNEL}`, { headers: BEARER });

      expect(reply.status).toBe(200);
      expect(JSON.parse(reply.text)).toEqual({ channelId: CHANNEL, name: "General" });
      expect(app.calls.events).toContain("app pipe custom");
    });

    test("a schemaInvalid refusal passes through an app interceptor's catchError and answers the contract's 400", async () => {
      app.scenario.interceptor.record = true;

      const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
        headers: writeHeaders(),
        body: JSON.stringify({ title: "" }),
      });

      expect(reply.status).toBe(400);
      expect(JSON.parse(reply.text)).toMatchObject({ code: "api.schema_invalid" });
      expect(app.calls.events).toEqual([
        "interceptor before handle",
        "app pipe custom",
        "interceptor error ContractError",
      ]);
    });

    test("an app interceptor that replaces a contract refusal gets the contract's 500 under strict", async () => {
      app.scenario.interceptor.replaceError = new app.AppReply(418, "text/plain", "replaced");

      const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
        headers: writeHeaders(),
        body: JSON.stringify({ title: "" }),
      });

      expect(reply.status).toBe(500);
      expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
    });

    test("an idempotent replay writes the stored reply through the app's interceptors", async () => {
      const headers = writeHeaders();
      const path = `/v1/channels/${CHANNEL}/tasks`;
      const body = JSON.stringify({ title: "Plan", effort: 2 });
      const first = await send("POST", path, { headers, body });

      app.scenario.interceptor.record = true;

      const second = await send("POST", path, { headers, body });

      expect([first.status, second.status]).toEqual([201, 201]);
      expect(second.text).toBe(first.text);
      expect(app.calls.handled).toEqual(["createTask"]);
      expect(app.calls.events).toContain("interceptor after undefined");
    });

    // In the handler mode the reply is written before an app interceptor's post-phase runs.
    test.runIf(reply === "interceptor")(
      "an app interceptor error after a claim completes the record as a handler error would",
      async () => {
        const headers = writeHeaders();
        const path = `/v1/channels/${CHANNEL}/tasks`;
        const body = JSON.stringify({ title: "Plan" });

        vi.spyOn(console, "error").mockImplementation(() => undefined);
        app.scenario.interceptor.failAfter = true;

        const failed = await send("POST", path, { headers, body });

        app.scenario.interceptor.failAfter = false;

        const retried = await send("POST", path, { headers, body });

        expect([failed.status, retried.status]).toEqual([500, 201]);
        expect(app.calls.handled).toEqual(["createTask", "createTask"]);
      },
    );

    test("an app route keeps Express's ETag", async () => {
      const reply = await send("GET", "/own/hello");

      expect(reply.status).toBe(200);
      expect(reply.headers.etag).toMatch(/^W\//);
    });

    test("an app global interceptor's mapping reaches the wire only in the interceptor mode", async () => {
      app.scenario.interceptor.map = () => ({
        status: 200,
        body: { channelId: CHANNEL, name: "Mapped" },
      });

      const served = await send("GET", `/v1/channels/${CHANNEL}`, { headers: BEARER });

      expect(JSON.parse(served.text)).toEqual({
        channelId: CHANNEL,
        name: reply === "handler" ? "General" : "Mapped",
      });
    });

    test("an app interceptor mapping to an undeclared shape gets the contract's 500 in the interceptor mode", async () => {
      app.scenario.interceptor.map = () => ({ status: 299, body: {} });

      const served = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, {
        headers: BEARER,
      });

      expect(served.status).toBe(reply === "handler" ? 200 : 500);
    });

    test.runIf(reply === "interceptor")(
      "an interceptor answering without next.handle() gets 500 in the interceptor mode",
      async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

        app.scenario.interceptor.answer = { status: 200, body: { status: "ok" } };

        const served = await send("GET", "/v1/health");

        expect(served.status).toBe(500);
        expect(app.calls.handled).toEqual([]);
        expect(error).toHaveBeenCalledWith(
          expect.stringContaining("answered 'health' without calling next.handle()"),
        );
      },
    );

    test.runIf(reply === "interceptor")(
      "an inner interceptor emitting twice gets one reply and no dropped write",
      async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

        app.scenario.interceptor.emitTwice = true;

        const served = await send("GET", "/v1/health");

        expect(served.status).toBe(200);
        expect(error).not.toHaveBeenCalledWith(expect.stringContaining("already sent"));
      },
    );

    test.runIf(reply === "interceptor")("the reply interceptor is the outermost global", () => {
      expect(server.globalInterceptors).toEqual([
        "ContractReplyInterceptor",
        "RecordingInterceptor",
      ]);
    });
  });

  describe("the operation composite", () => {
    test("the operation composite registers no interceptor", () => {
      expect(Reflect.getMetadata("__interceptors__", app.TasksController.prototype.health)).toBe(
        undefined,
      );
    });

    test("metadata set below the composite reaches the handler NestJS registers", () => {
      const handler = app.TasksController.prototype.health;

      expect(Reflect.getMetadata(app.APP_MARKER, handler)).toBe("below");
      expect([handler?.name, handler?.length]).toEqual(["handle", 1]);
    });

    test("an app guard above a decorator that rewraps the composite runs before authentication", async () => {
      const authenticate = app.scenario.authenticate;

      app.scenario.authenticate = (request) => {
        app.calls.events.push("authenticate");

        return authenticate(request);
      };

      const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, { headers: BEARER });

      expect(reply.status).toBe(200);
      expect(app.calls.events).toEqual(["app guard", "authenticate", "app pipe custom"]);
    });

    test("a contract method called outside a request returns its handler's result", () => {
      const controller = new app.TasksController();

      expect(controller.health?.(undefined)).toEqual({ status: 200, body: { status: "ok" } });
    });

    test("a contract method called by another handler writes no reply", async () => {
      let inner: unknown;

      app.scenario.answers.getChannel = (_input, controller) => {
        inner = controller.health?.(undefined);

        return { status: 200, body: { channelId: CHANNEL, name: "General" } };
      };

      const reply = await send("GET", `/v1/channels/${CHANNEL}`, { headers: BEARER });

      expect(reply.status).toBe(200);
      expect(JSON.parse(reply.text)).toEqual({ channelId: CHANNEL, name: "General" });
      expect(inner).toEqual({ status: 200, body: { status: "ok" } });
      expect(app.calls.handled).toEqual(["getChannel", "health"]);
    });
  });

  describe("the boot check", () => {
    test("a second registration of the api in one app stops the boot", async () => {
      await expect(app.bootTwice()).rejects.toThrow(/registered twice/);
    });

    test("each contract route with app interceptors warns once that a mapping they return is ignored", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await app.bootWithAppInterceptors();

      const warnings = warn.mock.calls.map((call) => String(call[0]));
      const healthWarnings = warnings.filter((warning) => warning.includes("'health'"));
      const globalWarnings = warnings.filter((warning) => warning.includes("global interceptors"));

      if (reply === "interceptor") {
        expect(warnings).toEqual([]);

        return;
      }

      expect(warnings).toHaveLength(18);
      expect(globalWarnings).toEqual([
        "seampact: the app's global interceptors AppModuleInterceptor run on every contract route of the api 'tasks'; they observe the reply seampact wrote and a value they map is ignored. Shape the reply in the handler, or generate the api with the target option reply: interceptor.",
      ]);
      expect(healthWarnings).toEqual([
        "seampact: the route GET /v1/health of 'health' carries the app interceptors ControllerWideInterceptor, PassThroughInterceptor; they observe the reply seampact wrote and a value they map is ignored. Shape the reply in the handler instead.",
      ]);
    });

    test.runIf(reply === "interceptor")(
      "a global interceptor placed in front after seampact's configure warns that it runs outside the reply",
      async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        await app.bootWithLateGlobalInterceptor();

        expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
          "seampact: the app's global interceptors LateGlobalInterceptor run outside the reply interceptor of the api 'tasks'; on its contract routes they observe the reply seampact wrote and a value they map is ignored. Register them with app.useGlobalInterceptors(...), which places them inside it.",
        ]);
      },
    );

    test("a cache interceptor on a contract route refuses the boot", async () => {
      await expect(app.bootWithCacheInterceptor(false)).rejects.toThrow(
        /health.*AppCacheInterceptor can answer GET \/v1\/health from its cache/s,
      );
    });

    test("a cache interceptor that skips contract routes boots", async () => {
      await expect(app.bootWithCacheInterceptor(true)).resolves.toBeUndefined();
    });

    test("a contract method without its input param refuses the boot", async () => {
      await expect(app.bootWithoutInputParam()).rejects.toThrow(
        /health\(\) has no input parameter.*@health\.input\(\) input/s,
      );
    });

    test("a module that appends a route guard after seampact's configure refuses the boot", async () => {
      await expect(app.bootWithLateGuard()).rejects.toThrow(
        /the seampact guard is not the last guard of health\(\): LateGuard run after it/,
      );
    });

    test("a route whose guards were cleared refuses the boot", async () => {
      await expect(app.bootWithoutGuard()).rejects.toThrow(
        /the seampact guard is not the last guard of health\(\): the route has no seampact guard/,
      );
    });

    test("a request-scoped interceptor on a contract route warns that the cache check skips it", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await app.bootWithRequestScopedInterceptor();

      expect(warn.mock.calls.map((call) => String(call[0]))).toContainEqual(
        expect.stringContaining("request-scoped interceptors ScopedInterceptor"),
      );
    });

    test("a logger that is not one refuses the boot", async () => {
      await expect(app.bootWithModuleOptions({ logger: {}, level: "debug" })).rejects.toThrow(
        /'level' is not an option of SeampactModule.forRoot.*'logger' is not an object/s,
      );
    });

    // Last in the mode: the logger stays installed for the api's generated tree.
    test("the boot writes its warnings to the logger forRoot receives", async () => {
      const logged: unknown[][] = [];
      const logger = { warn: (...parts: unknown[]) => logged.push(parts), error: () => undefined };

      await app.bootWithModuleOptions({ logger });
      await (reply === "interceptor"
        ? app.bootWithLateGlobalInterceptor()
        : app.bootWithAppInterceptors());

      expect(logged.length).toBeGreaterThan(0);
    });
  });
});
