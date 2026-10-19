// A NestJS app around the generated `tasks` boundary, for the live boundary test: every operation bound on one
// controller, hooks and handler answers driven by a scenario the test sets, an app filter, app middleware, CORS and
// routes of the app's own. Plain JavaScript, as a loosely typed app would write its hooks; copied next to the
// compiled generated tree, so it imports the generated modules by relative path. Decorators are applied by call.
import "reflect-metadata";
import { gzipSync } from "node:zlib";
import { Body, Catch, Controller, Get, Module, Post, UseFilters } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import * as TasksNest from "../generated/server/tasks/nestjs.js";

export const ALLOWED_ORIGIN = "https://app.example";

const TASK_OPERATIONS = [
  "archiveTask",
  "assignTask",
  "createTask",
  "deleteDraft",
  "getChannel",
  "getDraft",
  "getPreferences",
  "getTask",
  "getTasksBatch",
  "health",
  "listChannels",
  "listTasks",
  "payments",
  "purgeTask",
  "searchTasks",
  "updatePreferences",
  "updateTask",
];

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

/** Thrown by a handler to make the app's own filter write a reply, with Express's `send`, Node's `writeHead`, or a body
 * in a content encoding (`encoding:gzip`). */
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
class AppReplyFilter {
  catch(exception, host) {
    const response = host.switchToHttp().getResponse();

    if (exception.writer.startsWith("encoding:")) {
      const encoding = exception.writer.slice("encoding:".length);
      const body = encoding === "gzip" ? gzipSync(exception.body) : Buffer.from(exception.body);

      response
        .status(exception.status)
        .type(exception.contentType)
        .set("content-encoding", encoding)
        .end(body);

      return;
    }

    if (exception.writer === "writeHead") {
      response
        .writeHead(exception.status, { "content-type": exception.contentType, etag: '"app-etag"' })
        .end(exception.body);

      return;
    }

    response.status(exception.status).type(exception.contentType).send(exception.body);
  }
}

Catch(AppReply)(AppReplyFilter);

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
  createTask: () => ({ status: 201, body: sampleTask("33333333-3333-4333-8333-333333333333") }),
};

function answer(operation, input) {
  calls.handled.push(operation);

  const handler = scenario.answers[operation] ?? DEFAULT_ANSWERS[operation];

  if (handler === undefined) throw new Error(`the test app has no answer for '${operation}'`);

  return handler(input);
}

class TasksController {}

for (const operation of TASK_OPERATIONS) {
  const prototype = TasksController.prototype;

  Object.defineProperty(prototype, operation, {
    value: function handle(input) {
      return answer(operation, input);
    },
    writable: true,
    configurable: true,
  });

  TasksNest[operation].input()(prototype, operation, 0);
  TasksNest[operation]()(
    prototype,
    operation,
    Object.getOwnPropertyDescriptor(prototype, operation),
  );
}

TasksNest.responses("warn")(
  TasksController.prototype,
  "getChannel",
  Object.getOwnPropertyDescriptor(TasksController.prototype, "getChannel"),
);
Controller()(TasksController);
UseFilters(new AppReplyFilter())(TasksController);

// Routes of the app's own, which the boundary never touches.
class OwnController {
  boom() {
    throw new Error("own boom");
  }

  echo(body) {
    return body;
  }
}

Get("own/boom")(
  OwnController.prototype,
  "boom",
  Object.getOwnPropertyDescriptor(OwnController.prototype, "boom"),
);
Body()(OwnController.prototype, "echo", 0);
Post("own/echo")(
  OwnController.prototype,
  "echo",
  Object.getOwnPropertyDescriptor(OwnController.prototype, "echo"),
);
Controller()(OwnController);

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

const hooks = {
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

class ReferenceModule {}

Module({
  imports: [TasksNest.SeampactModule.forRoot(hooks)],
  controllers: [TasksController, OwnController],
})(ReferenceModule);

const recordingLogger = {
  log() {},
  warn() {},
  debug() {},
  verbose() {},
  fatal() {},
  error(...parts) {
    calls.loggedErrors.push(parts.map((part) => String(part?.stack ?? part)).join(" "));
  },
};

/** Boots an app that imports the api's module twice, with two hook objects; resolves once initialised. */
export async function bootTwice() {
  class TwiceModule {}

  Module({
    imports: [
      TasksNest.SeampactModule.forRoot(hooks),
      TasksNest.SeampactModule.forRoot({ ...hooks }),
    ],
    controllers: [TasksController],
  })(TwiceModule);

  const app = await NestFactory.create(TwiceModule, { rawBody: true, logger: recordingLogger });

  try {
    await app.init();
  } finally {
    await app.close();
  }
}

/** Boots the app on a free port with the documented setup 1 (`rawBody: true`). */
export async function startReferenceApp() {
  resetScenario();

  const app = await NestFactory.create(ReferenceModule, { rawBody: true, logger: recordingLogger });

  app.enableCors({ origin: ALLOWED_ORIGIN });
  app.use((_request, response, next) => {
    response.setHeader("strict-transport-security", "max-age=63072000");
    response.setHeader("x-content-type-options", "nosniff");
    next();
  });
  app.useBodyParser("json", { limit: TasksNest.LARGEST_BODY_LIMIT, strict: false });
  app.useGlobalFilters(TasksNest.preRoutingFilter);
  await app.listen(0, "127.0.0.1");

  const { port } = app.getHttpServer().address();

  return { host: "127.0.0.1", port, close: () => app.close() };
}
