import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  type AdonisMajor,
  emitProject,
  generateReferenceProject,
  projectDirectory,
} from "./reference-project.test-support.js";

// Boots AdonisJS 7 and 6 around the generated `tasks` boundary (the app in `test-app/`) and sends requests to it:
// the wire behaviour the compile test cannot see, the same on both majors.

const APP_SOURCE = new URL("../test-app/reference-app.js", import.meta.url);
const MAJORS: readonly AdonisMajor[] = [7, 6];
const REPLY_TIMEOUT_MILLISECONDS = 3000;
// Generating and compiling both apis outruns vitest's default 10 s hook limit on a loaded machine.
const SETUP_TIMEOUT_MILLISECONDS = 60_000;

const CHANNEL = "11111111-1111-4111-8111-111111111111";
const TASK = "44444444-4444-4444-8444-444444444444";
const DRAFT = "66666666-6666-4666-8666-666666666666";
const USER = "55555555-5555-4555-8555-555555555555";
const BEARER = { authorization: `Bearer user-${USER}` };
const PROBLEM_MEDIA = "application/problem+json";
const STRIPE_SIGNATURE = { "stripe-signature": "t=1700000000,v1=00" };
const BYTE_ORDER_MARK = "﻿";
const ONE_MEBIBYTE = 1024 * 1024;

interface UnexpectedCall {
  readonly exceptionOrReply: unknown;
  readonly context: { readonly operation?: string };
}

interface ReferenceAppModule {
  readonly calls: {
    readonly handled: string[];
    readonly inputs: Record<string, { body?: { title?: string } }>;
    readonly rawBodies: string[];
    readonly unexpected: UnexpectedCall[];
    readonly reported: string[];
  };
  readonly scenario: {
    answers: Record<string, (input: unknown) => unknown>;
  };
  readonly AppReply: new (
    status: number,
    contentType: string,
    body: string,
    writer?: string,
  ) => Error;
  readonly RenderedByHelper: new (cause: unknown) => Error;
  frameworkRefusal(code: string, status: number): Error;
  registration(): Record<string, unknown>;
  resetScenario(): void;
  startReferenceApp(major: AdonisMajor): Promise<RunningApp>;
}

interface RunningApp {
  readonly host: string;
  readonly port: number;
  readonly app: { config: { get(key: string): unknown; set(key: string, value: unknown): void } };
  readonly router: unknown;
  close(): Promise<void>;
}

interface GeneratedAdonisModule {
  registerRoutes(router: unknown, registration: Record<string, unknown>): void;
  readonly ROUTE_NAMES_BY_ACCESS: Readonly<Record<string, readonly string[]>>;
}

interface Reply {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly text: string;
}

function problemBody(code: string, status: number): string {
  return JSON.stringify({ type: code, title: code, status, code, nature: "refused" });
}

// The route names in the order the router matches them.
function routeNames(router: unknown): string[] {
  const json: unknown = Reflect.apply(Reflect.get(Object(router), "toJSON"), router, []);
  const routes: unknown[] = Object.values(Object(json)).flat();

  return routes.map((route) => String(Reflect.get(Object(route), "name")));
}

function writeHeaders(): Record<string, string> {
  return { ...BEARER, "idempotency-key": randomUUID() };
}

describe.each(MAJORS)("AdonisJS %i", (major) => {
  const project = projectDirectory(`live-boundary-${major}`);
  const build = join(project, "build");
  let app: ReferenceAppModule;
  let generated: GeneratedAdonisModule;
  let server: RunningApp;

  // A raw request: the path goes out byte for byte, without WHATWG URL normalization.
  function send(
    method: string,
    path: string,
    options: { headers?: Record<string, string>; body?: string | Buffer } = {},
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

  beforeAll(async () => {
    const files = await generateReferenceProject(project, major, { bodyValidation: true });

    expect(emitProject(project, files, build)).toEqual([]);

    mkdirSync(join(build, "app"), { recursive: true });
    copyFileSync(APP_SOURCE, join(build, "app", "reference-app.js"));
    app = await import(pathToFileURL(join(build, "app", "reference-app.js")).href);
    server = await app.startReferenceApp(major);
    generated = await import(
      pathToFileURL(join(build, "generated", "server", "tasks", "index.js")).href
    );
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await server?.close();
  });

  beforeEach(() => {
    app.resetScenario();
    vi.restoreAllMocks();
  });

  describe("replies on contract routes", () => {
    test("a boundary reply carries no AdonisJS ETag or request id, and keeps the app's headers", async () => {
      const reply = await send("GET", `/v1/channels/${CHANNEL}`, { headers: BEARER });

      expect(reply.status).toBe(200);
      expect(JSON.parse(reply.text)).toMatchObject({ channelId: CHANNEL });
      expect(reply.headers["x-request-id"]).toBeUndefined();
      expect(reply.headers["x-content-type-options"]).toBe("nosniff");
    });

    test("an app route keeps AdonisJS's ETag", async () => {
      const reply = await send("GET", "/own/ping");

      expect(reply.status).toBe(200);
      expect(reply.headers.etag).toBeDefined();
    });

    test("a framework refusal thrown by the controller is mapped by its code", async () => {
      app.scenario.answers.createTask = () => {
        throw app.frameworkRefusal("E_AUTHORIZATION_FAILURE", 403);
      };

      const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
        headers: writeHeaders(),
        body: JSON.stringify({ title: "Plan" }),
      });

      expect(reply.status).toBe(403);
      expect(JSON.parse(reply.text)).toMatchObject({ code: "api.forbidden" });
    });

    test("a framework refusal whose status the operation does not declare is a 500", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      app.scenario.answers.getTask = () => {
        throw app.frameworkRefusal("E_AUTHORIZATION_FAILURE", 403);
      };

      const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, {
        headers: BEARER,
      });

      expect(reply.status).toBe(500);
    });

    test("an undeclared status the app's exception handler writes becomes a 500", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      app.scenario.answers.getTask = () => {
        throw new app.AppReply(418, "text/plain", "teapot");
      };

      const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, {
        headers: BEARER,
      });

      expect(reply.status).toBe(500);
      expect(app.calls.unexpected).toHaveLength(1);
    });

    test.each(["send", "writeHead"])(
      "a declared error the app's handler writes with %s passes, with no foreign ETag",
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

    test("an operation's responses override sends a violation as written under warn", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      app.scenario.answers.getChannel = () => {
        throw new app.AppReply(418, "text/plain", "teapot");
      };

      const reply = await send("GET", `/v1/channels/${CHANNEL}`, { headers: BEARER });

      expect(reply).toMatchObject({ status: 418, text: "teapot" });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("the undeclared status 418"));
    });

    test("renderContractError writes a mapped refusal from the app's exception handler", async () => {
      app.scenario.answers.getTask = () => {
        throw new app.RenderedByHelper(app.frameworkRefusal("E_UNAUTHORIZED_ACCESS", 401));
      };

      const reply = await send("GET", `/v1/channels/${CHANNEL}/tasks/${TASK}`, {
        headers: BEARER,
      });

      expect(reply.status).toBe(401);
      expect(JSON.parse(reply.text)).toMatchObject({ code: "api.unauthenticated" });
    });

    test("a controller missing a method answers 500 on every route of it, with a log", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const reply = await send("GET", `/v1/me/drafts/${DRAFT}`, { headers: BEARER });

      expect(reply.status).toBe(500);
      expect(app.calls.handled).toEqual([]);
      expect(error.mock.calls.flat().join("\n")).toContain("deleteDraft");
    });
  });

  describe("errors raised before the boundary", () => {
    test.each([
      ["malformed JSON", "{", 400],
      ["a top-level scalar", '"text"', 400],
    ])("%s answers the route's 400 in the api's format", async (_case, body, status) => {
      const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
        headers: writeHeaders(),
        body,
      });

      expect(reply.status).toBe(status);
      expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
      expect(app.calls.handled).toEqual([]);
    });

    test.each([
      ["csrf", 403, "api.csrf_invalid"],
      ["auth", 401, "api.unauthenticated"],
    ])(
      "a %s refusal of server middleware is rendered by the pre-routing helper",
      async (refusal, status, code) => {
        const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
          headers: { ...writeHeaders(), "x-test-refusal": refusal },
          body: JSON.stringify({ title: "Plan" }),
        });

        expect(reply.status).toBe(status);
        expect(JSON.parse(reply.text)).toMatchObject({ code });
      },
    );

    test("a plain error of server middleware on a contract path is a 500 in the api's format", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const reply = await send("GET", `/v1/channels/${CHANNEL}`, {
        headers: { ...BEARER, "x-test-refusal": "plain" },
      });

      expect(reply.status).toBe(500);
      expect(reply.headers["content-type"]).toContain(PROBLEM_MEDIA);
    });

    test.each([
      ["a method the path does not serve", "PUT"],
      ["HEAD on a GET route", "HEAD"],
    ])("%s answers the path's 404", async (_case, method) => {
      const reply = await send(method, `/v1/channels/${CHANNEL}/tasks/${TASK}`, {
        headers: BEARER,
      });

      expect(reply.status).toBe(404);
      expect(app.calls.handled).toEqual([]);
    });
  });

  describe("body checks", () => {
    test("a body over the route limit answers 413 with its limit", async () => {
      const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
        headers: writeHeaders(),
        body: JSON.stringify({ title: "x".repeat(ONE_MEBIBYTE + 1) }),
      });

      expect(reply.status).toBe(413);
      expect(app.calls.handled).toEqual([]);
    });

    test("a JSON body the bodyparser did not read answers 500 with the fix logged", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
        headers: { ...writeHeaders(), "content-type": "application/x-seampact+json" },
        body: JSON.stringify({ title: "Plan" }),
      });

      expect(reply.status).toBe(500);
      expect(app.calls.handled).toEqual([]);
      expect(
        app.calls.unexpected.map((call) => String(call.exceptionOrReply)).join("\n"),
      ).toContain("bodyparser_middleware");
      error.mockRestore();
    });

    test("string values reach the handler as sent, never trimmed or nulled", async () => {
      const reply = await send("POST", `/v1/channels/${CHANNEL}/tasks`, {
        headers: writeHeaders(),
        body: JSON.stringify({ title: "  padded  " }),
      });

      expect(reply.status).toBe(201);
      expect(app.calls.inputs.createTask?.body?.title).toBe("  padded  ");
    });

    test("a signed route's hook gets the received bytes", async () => {
      const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", data: {} });
      const reply = await send("POST", "/v1/hooks/payments", { headers: STRIPE_SIGNATURE, body });

      expect(reply.status).toBe(204);
      expect(app.calls.rawBodies).toEqual([Buffer.from(body).toString("hex")]);
    });

    test("a body with a byte-order mark reaches the hook without it, so a signature over the sent bytes fails", async () => {
      const body = JSON.stringify({ id: "evt_2", type: "invoice.paid", data: {} });
      const sent = Buffer.from(`${BYTE_ORDER_MARK}${body}`);

      await send("POST", "/v1/hooks/payments", { headers: STRIPE_SIGNATURE, body: sent });

      expect(app.calls.rawBodies).toEqual([Buffer.from(body).toString("hex")]);
      expect(app.calls.rawBodies).not.toContain(sent.toString("hex"));
    });
  });

  describe("names and the boot check", () => {
    test("routes are named <api>.<operation>, listed by access kind", () => {
      expect(generated.ROUTE_NAMES_BY_ACCESS).toMatchObject({
        public: ["tasks.health"],
        signed: ["tasks.payments"],
      });
      expect(generated.ROUTE_NAMES_BY_ACCESS.identity).toContain("tasks.createTask");
    });

    test("routes are added most specific first, a static segment before a param", () => {
      const names = routeNames(server.router);

      expect(names.indexOf("tasks.getTasksBatch")).toBeLessThan(names.indexOf("tasks.archiveTask"));
      expect(names.indexOf("tasks.searchTasks")).toBeLessThan(names.indexOf("tasks.purgeTask"));
    });

    test("an override for an operation the api does not have stops the boot", () => {
      expect(() =>
        generated.registerRoutes(server.router, {
          ...app.registration(),
          operations: { createTsk: { responses: "warn" } },
        }),
      ).toThrow(/operations\.createTsk/);
    });

    test("a missing controller and a bodyparser limit below the largest route limit stop the boot", () => {
      const limit = server.app.config.get("bodyparser.json.limit");

      server.app.config.set("bodyparser.json.limit", "1kb");

      try {
        expect(() =>
          generated.registerRoutes(server.router, { ...app.registration(), controllers: {} }),
        ).toThrow(/AppEndpoints[\s\S]*json\.limit/);
      } finally {
        server.app.config.set("bodyparser.json.limit", limit);
      }
    });
  });
});
