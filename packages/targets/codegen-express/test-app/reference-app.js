// An Express app around the generated `tasks` router, for the live boundary test: every operation bound in one
// handler map, hooks and handler answers driven by a scenario the test sets, app middleware before the router, an
// app error middleware, routes of the app's own and a router mounted under a path. Plain JavaScript, as a loosely
// typed app would write its hooks; copied next to the compiled generated tree, so it imports the generated modules
// by relative path. The test links `express` to the major it runs.
import { gzipSync } from "node:zlib";
import express from "express";
import * as TasksExpress from "../generated/server/tasks/index.js";

export const ALLOWED_ORIGIN = "https://app.example";

/** A request carrying this header with a status is refused with it by app middleware before the router. */
export const FAIL_BEFORE_HEADER = "x-fail-before-router";

const HANDLER_INTERFACES = {
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
  DraftsEndpoints: ["getDraft", "deleteDraft"],
  PreferencesEndpoints: ["getPreferences", "updatePreferences"],
  HooksEndpoints: ["payments"],
};

const USER_TOKEN_PREFIX = "user-";

/** What the hooks and handlers saw, read by the test. */
export const calls = { scopeIds: [], handled: [], unexpected: [], loggedErrors: [] };

/** How the hooks and handlers answer; the test replaces members and calls `resetScenario` between tests. */
export const scenario = {};

export function resetScenario() {
  scenario.answers = {};
  scenario.authenticate = authenticateByBearer;
  scenario.decide = () => ({ allow: true });
  calls.scopeIds.length = 0;
  calls.handled.length = 0;
  calls.unexpected.length = 0;
  calls.loggedErrors.length = 0;
}

/** Thrown by a handler to make the app's error middleware write a reply, with Express's `send`, Node's
 * `writeHead`, or a body in a content encoding (`encoding:gzip`). */
export class AppReply extends Error {
  constructor(status, contentType, body, writer = "send") {
    super(`app reply ${status}`);
    this.status = status;
    this.contentType = contentType;
    this.body = body;
    this.writer = writer;
  }
}

// The `writeHead` form passes its headers as an argument, an ETag included, as some frameworks do.
function appReplyMiddleware(error, _request, response, next) {
  if (!(error instanceof AppReply)) {
    next(error);

    return;
  }

  if (error.writer.startsWith("encoding:")) {
    const encoding = error.writer.slice("encoding:".length);
    const body = encoding === "gzip" ? gzipSync(error.body) : Buffer.from(error.body);

    response
      .status(error.status)
      .type(error.contentType)
      .set("content-encoding", encoding)
      .end(body);

    return;
  }

  if (error.writer === "writeHead") {
    response
      .writeHead(error.status, { "content-type": error.contentType, etag: '"app-etag"' })
      .end(error.body);

    return;
  }

  response.status(error.status).type(error.contentType).send(error.body);
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
  createTask: () => ({ status: 201, body: sampleTask(crypto.randomUUID()) }),
};

// A class instance per interface, so the test proves the router keeps `this`.
class ScenarioHandlers {
  constructor(operations) {
    for (const operation of operations) {
      this[operation] = function handle(input) {
        return this.answer(operation, input);
      };
    }
  }

  answer(operation, input) {
    calls.handled.push(operation);

    const handler = scenario.answers[operation] ?? DEFAULT_ANSWERS[operation];

    if (handler === undefined) throw new Error(`the test app has no answer for '${operation}'`);

    return handler(input);
  }
}

export const handlers = Object.fromEntries(
  Object.entries(HANDLER_INTERFACES).map(([name, operations]) => [
    name,
    new ScenarioHandlers(operations),
  ]),
);

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

export const hooks = {
  authenticate: {
    user: { authenticate: (request) => scenario.authenticate(request) },
    stripe: { authenticate: () => ({ principal: { account: "acct_1" } }) },
  },
  deciders: [{ names: "all", decider: { decide: (request) => scenario.decide(request) } }],
  scopeResolvers: {
    channel: {
      resolveScope(request) {
        calls.scopeIds.push(request.source.id);

        return { resolved: { scope: "channel", id: request.source.id } };
      },
    },
  },
  idempotencyStore: memoryIdempotencyStore(),
  onUnexpectedError(exceptionOrReply, context) {
    calls.unexpected.push({ exceptionOrReply, context });
  },
};

/** Builds the app and listens on a free port. */
export async function startReferenceApp() {
  resetScenario();

  const app = express();

  app.use((request, response, next) => {
    if (request.headers.origin === ALLOWED_ORIGIN) {
      response.setHeader("access-control-allow-origin", ALLOWED_ORIGIN);
      response.setHeader("vary", "Origin");
    }

    response.setHeader("strict-transport-security", "max-age=63072000");
    response.setHeader("x-content-type-options", "nosniff");

    const failure = request.headers[FAIL_BEFORE_HEADER];

    if (typeof failure === "string") {
      next(Object.assign(new Error("refused before the router"), { status: Number(failure) }));

      return;
    }

    next();
  });
  app.use(
    TasksExpress.router({ handlers, hooks, operations: { getChannel: { responses: "warn" } } }),
  );
  app.use("/mounted", TasksExpress.router({ handlers, hooks }));
  app.get("/own/boom", () => {
    throw new Error("own boom");
  });
  app.post("/own/echo", express.json(), (request, response) => {
    response.json(request.body);
  });
  app.use(TasksExpress.preRoutingErrorHandler);
  app.use(appReplyMiddleware);
  app.use((error, _request, response, _next) => {
    calls.loggedErrors.push(String(error?.stack ?? error));
    response.status(error?.status ?? 500).json({ message: String(error?.message ?? error) });
  });

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = server.address();

  return {
    host: "127.0.0.1",
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
