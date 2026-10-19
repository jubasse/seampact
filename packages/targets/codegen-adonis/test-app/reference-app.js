// An AdonisJS app around the generated `tasks` boundary, for the live boundary test: every operation bound on
// controllers built from the shared answers, hooks and handler answers driven by a scenario the test sets, an app
// exception handler, server middleware and routes of the app's own. Plain JavaScript, copied next to the compiled
// generated tree, so it imports the generated modules by relative path; it runs on the AdonisJS major the project
// links as `@adonisjs/core`. The app is created in process with its config passed in code, as no config directory
// exists.
import { createServer } from "node:http";
import { Ignitor } from "@adonisjs/core";
import { defineConfig as defineBodyparserConfig } from "@adonisjs/core/bodyparser";
import { defineConfig as defineHttpConfig, ExceptionHandler } from "@adonisjs/core/http";
import { defineConfig as defineLoggerConfig } from "@adonisjs/core/logger";

// The generated module, imported once the app exists, as an app's preloaded start/routes.ts imports it.
let TasksAdonis;

const APP_ROOT = new URL("./", import.meta.url);
const APP_KEY = "seampact-live-boundary-app-key-32";
const USER_TOKEN_PREFIX = "user-";
const HOST = "127.0.0.1";

// The controller methods of each handler interface of the `tasks` api.
const CONTROLLER_METHODS = {
  AppEndpoints: ["health"],
  ChannelsEndpoints: ["listChannels", "getChannel"],
  TasksEndpoints: [
    "listTasks",
    "createTask",
    "getTasksBatch",
    "searchTasks",
    "getTask",
    "updateTask",
    "archiveTask",
    "assignTask",
    "purgeTask",
  ],
  // `deleteDraft` is left out: every drafts route answers 500 with a log.
  DraftsEndpoints: ["getDraft"],
  PreferencesEndpoints: ["getPreferences", "updatePreferences"],
  HooksEndpoints: ["payments"],
};

/** What the hooks and handlers saw, read by the test. */
export const calls = { handled: [], inputs: {}, rawBodies: [], unexpected: [], reported: [] };

/** How the hooks and handlers answer; the test replaces members and calls `resetScenario` between tests. */
export const scenario = {};

export function resetScenario() {
  scenario.answers = {};
  scenario.authenticate = authenticateByBearer;
  scenario.decide = () => ({ allow: true });
  calls.handled.length = 0;
  calls.rawBodies.length = 0;
  calls.unexpected.length = 0;
  calls.reported.length = 0;

  for (const key of Object.keys(calls.inputs)) delete calls.inputs[key];
}

/** Thrown by a handler to make the app's exception handler write a reply, lazily or with Node's `writeHead`. */
export class AppReply extends Error {
  constructor(status, contentType, body, writer = "send") {
    super(`app reply ${status}`);
    this.status = status;
    this.contentType = contentType;
    this.body = body;
    this.writer = writer;
  }
}

/** Thrown by a handler to make the app's exception handler call the generated `renderContractError`. */
export class RenderedByHelper extends Error {
  constructor(cause) {
    super("rendered by renderContractError");
    this.cause = cause;
  }
}

/** A framework refusal as AdonisJS packages raise it, matched by its `code` and `status`. */
export function frameworkRefusal(code, status) {
  return Object.assign(new Error(code), { code, status });
}

class AppExceptionHandler extends ExceptionHandler {
  debug = false;

  async handle(error, ctx) {
    if (await TasksAdonis.renderPreRoutingError(error, ctx)) return;

    if (error instanceof RenderedByHelper) {
      if (await TasksAdonis.renderContractError(ctx, error.cause)) return;
    }

    if (error instanceof AppReply) {
      writeAppReply(error, ctx);

      return;
    }

    return super.handle(error, ctx);
  }

  async report(error) {
    calls.reported.push(String(error?.message ?? error));
  }
}

// The `writeHead` form passes its headers as an argument, an ETag included, as AdonisJS's own writer does.
function writeAppReply(error, ctx) {
  if (error.writer === "writeHead") {
    ctx.response.response
      .writeHead(error.status, { "content-type": error.contentType, etag: '"app-etag"' })
      .end(error.body);

    return;
  }

  ctx.response.status(error.status).header("content-type", error.contentType).send(error.body);
}

// Server middleware: a header on every reply, and the refusals shield and auth raise before the boundary.
/** A request header that makes the app drop the body the bodyparser read, as an app without its middleware would. */
export const DROP_PARSED_BODY_HEADER = "x-test-drop-parsed-body";

// Router middleware after the bodyparser: with the header, the request keeps no raw body.
class DropParsedBodyMiddleware {
  async handle(ctx, next) {
    if (ctx.request.header(DROP_PARSED_BODY_HEADER) !== undefined) ctx.request.updateRawBody("");

    return next();
  }
}

class AppServerMiddleware {
  async handle(ctx, next) {
    ctx.response.response.setHeader("x-content-type-options", "nosniff");

    const refusal = ctx.request.header("x-test-refusal");

    if (refusal === "csrf") throw frameworkRefusal("E_BAD_CSRF_TOKEN", 403);

    if (refusal === "auth") throw frameworkRefusal("E_UNAUTHORIZED_ACCESS", 401);

    if (refusal === "plain") throw new Error("server middleware failure");

    return next();
  }
}

function authenticateByBearer(request) {
  const token = request.credentials.bearer;

  if (typeof token === "string" && token.startsWith(USER_TOKEN_PREFIX)) {
    return { principal: { userId: token.slice(USER_TOKEN_PREFIX.length) } };
  }

  return { deny: { code: "api.unauthenticated" } };
}

function sampleTask(taskId) {
  return {
    taskId,
    title: "Write the slice",
    state: "open",
    effort: 3,
    version: 1,
    createdAt: "2026-10-19T08:00:00Z",
  };
}

const DEFAULT_ANSWERS = {
  health: () => ({ status: 200, body: { status: "ok" } }),
  getChannel: (input) => ({
    status: 200,
    body: { channelId: input.path.channelId, name: "General" },
  }),
  getTask: (input) => ({ status: 200, body: sampleTask(input.path.taskId) }),
  createTask: (input) => ({
    status: 201,
    body: { ...sampleTask("33333333-3333-4333-8333-333333333333"), title: input.body.title },
  }),
  payments: () => ({ status: 204 }),
};

function answer(operation, input) {
  calls.handled.push(operation);
  calls.inputs[operation] = input;

  const handler = scenario.answers[operation] ?? DEFAULT_ANSWERS[operation];

  if (handler === undefined) throw new Error(`the test app has no answer for '${operation}'`);

  return handler(input);
}

function controllerModule(methods) {
  class Controller {}

  for (const operation of methods) {
    Object.defineProperty(Controller.prototype, operation, {
      value: function handle(input) {
        return answer(operation, input);
      },
      writable: true,
      configurable: true,
    });
  }

  return { default: Controller };
}

function memoryIdempotencyStore() {
  const records = new Map();

  return {
    begin(claim) {
      const record = records.get(claim.key);

      if (record === undefined) {
        records.set(claim.key, { fingerprint: claim.fingerprint });

        return { outcome: "started" };
      }

      if (record.fingerprint !== claim.fingerprint) return { outcome: "mismatch" };

      return record.response === undefined
        ? { outcome: "running" }
        : { outcome: "replay", response: record.response };
    },
    complete(key, response) {
      const record = records.get(key);

      if (record !== undefined) record.response = response;
    },
    abandon(key) {
      records.delete(key);
    },
  };
}

/** The registration the app passes to `registerRoutes`. */
export function registration() {
  return {
    controllers: Object.fromEntries(
      Object.entries(CONTROLLER_METHODS).map(([name, methods]) => [
        name,
        () => Promise.resolve(controllerModule(methods)),
      ]),
    ),
    hooks: {
      authenticate: {
        user: { authenticate: (request) => scenario.authenticate(request) },
        stripe: {
          authenticate(request) {
            calls.rawBodies.push(Buffer.from(request.signature.rawBody).toString("hex"));

            return { principal: { account: "acct_1" } };
          },
        },
      },
      deciders: [{ names: "all", decider: { decide: (request) => scenario.decide(request) } }],
      scopeResolvers: {
        channel: {
          resolveScope: (request) => ({ resolved: { scope: "channel", id: request.source.id } }),
        },
      },
      idempotencyStore: memoryIdempotencyStore(),
      onUnexpectedError(exceptionOrReply, context) {
        calls.unexpected.push({ exceptionOrReply, context });
      },
    },
    operations: { getChannel: { responses: "warn" } },
  };
}

// AdonisJS 7 needs an encryption config, a module AdonisJS 6 does not ship.
async function majorConfig(major) {
  if (major < 7) return {};

  const { defineConfig, drivers } = await import("@adonisjs/core/encryption");

  return {
    encryption: defineConfig({
      default: "app",
      list: { app: drivers.aes256gcm({ id: "app", keys: [APP_KEY] }) },
    }),
  };
}

/** Boots the app on a free port; `app` and `router` let the test run the boot check again. */
export async function startReferenceApp(major) {
  resetScenario();

  const ignitor = new Ignitor(APP_ROOT, {
    importer: (path) => import(new URL(path, APP_ROOT).href),
  });
  const app = ignitor.createApp("web");

  TasksAdonis = await import("../generated/server/tasks/index.js");

  app.rcContents({ providers: [() => import("@adonisjs/core/providers/app_provider")] });
  app.useConfig({
    app: { appKey: APP_KEY, http: defineHttpConfig({ etag: true, generateRequestId: true }) },
    logger: defineLoggerConfig({
      default: "app",
      loggers: { app: { enabled: false, name: "live-boundary", level: "error" } },
    }),
    bodyparser: defineBodyparserConfig({
      allowedMethods: ["POST", "PUT", "PATCH", "DELETE"],
      json: { limit: TasksAdonis.LARGEST_BODY_LIMIT, strict: true },
    }),
    ...(await majorConfig(major)),
  });
  await app.init();
  await app.boot();

  const router = await app.container.make("router");
  const server = await app.container.make("server");

  server.use([() => Promise.resolve({ default: AppServerMiddleware })]);
  router.use([
    () => import("@adonisjs/core/bodyparser_middleware"),
    () => Promise.resolve({ default: DropParsedBodyMiddleware }),
  ]);
  server.errorHandler(() => Promise.resolve({ default: AppExceptionHandler }));

  TasksAdonis.registerRoutes(router, registration());
  router.get("/own/ping", () => ({ pong: true }));
  // An app route on a path a contract template matches, with a method the contract does not serve there.
  router.put("/v1/channels/:channelId", () => {
    throw new AppReply(409, "text/plain", "own conflict");
  });

  await app.start(() => undefined);
  await server.boot();

  const nodeServer = createServer((request, response) => server.handle(request, response));

  await new Promise((resolve) => nodeServer.listen(0, HOST, resolve));

  return {
    host: HOST,
    port: nodeServer.address().port,
    app,
    router,
    close: async () => {
      await new Promise((resolve) => nodeServer.close(resolve));
      await app.terminate();
    },
  };
}
