// A NestJS app around the generated `tasks` boundary, for the live boundary test: every operation bound on one
// controller, hooks and handler answers driven by a scenario the test sets, an app filter, a global app pipe and
// interceptor, app middleware, CORS and routes of the app's own. Plain JavaScript, as a loosely typed app would write its hooks; copied next to the
// compiled generated tree, so it imports the generated modules by relative path. Decorators are applied by call.
import "reflect-metadata";
import { gzipSync } from "node:zlib";
import {
  Body,
  Catch,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Post,
  Scope,
  SetMetadata,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { APP_INTERCEPTOR, ApplicationConfig, NestFactory } from "@nestjs/core";
import { catchError, map, mergeMap, of, tap, throwError } from "rxjs";
import * as TasksNest from "../generated/server/tasks/nestjs.js";

export const ALLOWED_ORIGIN = "https://app.example";

/** A metadata key the app sets on `health` below its composite, as an app's `@Public()` does. */
export const APP_MARKER = "app:marker";

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
export const calls = { scopeIds: [], handled: [], unexpected: [], loggedErrors: [], events: [] };

/** How the hooks and handlers answer; the test replaces members and calls `resetScenario` between tests. */
export const scenario = {};

export function resetScenario() {
  scenario.answers = {};
  scenario.interceptor = {};
  scenario.authenticate = authenticateByBearer;
  scenario.decide = () => ({ allow: true });
  calls.scopeIds.length = 0;
  calls.handled.length = 0;
  calls.unexpected.length = 0;
  calls.loggedErrors.length = 0;
  calls.events.length = 0;
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

function answer(operation, input, controller) {
  calls.handled.push(operation);

  const handler = scenario.answers[operation] ?? DEFAULT_ANSWERS[operation];

  if (handler === undefined) throw new Error(`the test app has no answer for '${operation}'`);

  return handler(input, controller);
}

// Applies method decorators as TypeScript does: the last written first, then the descriptor they edited defined.
function decorateMethod(prototype, name, ...decorators) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, name);

  for (const decorator of decorators.reverse()) decorator(prototype, name, descriptor);

  Object.defineProperty(prototype, name, descriptor);
}

// Replaces the method with a function of its own and copies the method's metadata onto it, as a tracing
// decorator such as nestjs-otel's `@Span()` does.
function rewrapMethod(_prototype, _name, descriptor) {
  const original = descriptor.value;
  const rewrapped = function traced(...args) {
    return original.apply(this, args);
  };

  for (const key of Reflect.getMetadataKeys(original)) {
    Reflect.defineMetadata(key, Reflect.getMetadata(key, original), rewrapped);
  }

  descriptor.value = rewrapped;
}

class RecordingGuard {
  canActivate() {
    calls.events.push("app guard");

    return true;
  }
}

// What the app's global interceptor does, set by the test in `scenario.interceptor`: record its phases, map a
// result, replace an error, fail after the handler, or answer without calling the handler.
class RecordingInterceptor {
  intercept(execution, next) {
    const behaviour = scenario.interceptor;
    const operation = execution.getHandler().name;

    if (!TasksNest.isContractRoute(execution)) return next.handle();

    if (behaviour.answer !== undefined) return of(behaviour.answer);

    if (behaviour.record) calls.events.push(`interceptor before ${operation}`);

    return next.handle().pipe(
      tap((value) => {
        if (behaviour.record) calls.events.push(`interceptor after ${JSON.stringify(value)}`);

        if (behaviour.failAfter) throw new Error("interceptor failure");
      }),
      map((value) => (behaviour.map === undefined ? value : behaviour.map(value))),
      mergeMap((value) => (behaviour.emitTwice ? of(value, value) : of(value))),
      catchError((error) => {
        if (behaviour.record) calls.events.push(`interceptor error ${error.constructor.name}`);

        return throwError(() => behaviour.replaceError ?? error);
      }),
    );
  }
}

// A global app pipe that returns another value for every custom param, the contract input included.
class TamperingPipe {
  transform(value, metadata) {
    if (metadata.type !== "custom") return value;

    calls.events.push("app pipe custom");

    return { tampered: true };
  }
}

// A cache interceptor as `@nestjs/cache-manager`'s: it keys GET requests by URL, unless told to skip contract routes.
function cacheInterceptor(skipsContractRoutes) {
  return class AppCacheInterceptor {
    trackBy(execution) {
      if (skipsContractRoutes && TasksNest.isContractRoute(execution)) return undefined;

      const request = execution.switchToHttp().getRequest();

      return request.method === "GET" ? request.originalUrl : undefined;
    }

    intercept(_execution, next) {
      return next.handle();
    }
  };
}

class LateGuard {
  canActivate() {
    return true;
  }
}

class PassThroughInterceptor {
  intercept(_execution, next) {
    return next.handle();
  }
}

class ControllerWideInterceptor extends PassThroughInterceptor {}

class AppModuleInterceptor extends PassThroughInterceptor {}

class LateGlobalInterceptor extends PassThroughInterceptor {}

// Every operation bound on one controller class; `aboveComposite` lists the app decorators written above an
// operation's composite, and `withoutInput` the operations whose method declares no input param.
function tasksController(aboveComposite = {}, withoutInput = []) {
  class TasksController {}

  for (const operation of TASK_OPERATIONS) {
    const prototype = TasksController.prototype;

    Object.defineProperty(prototype, operation, {
      value: function handle(input) {
        return answer(operation, input, this);
      },
      writable: true,
      configurable: true,
    });

    if (!withoutInput.includes(operation)) TasksNest[operation].input()(prototype, operation, 0);
    decorateMethod(
      prototype,
      operation,
      ...(aboveComposite[operation] ?? []),
      TasksNest[operation](),
      ...(operation === "health" ? [SetMetadata(APP_MARKER, "below")] : []),
    );
  }

  return TasksController;
}

export const TasksController = tasksController({
  getTask: [UseGuards(RecordingGuard), rewrapMethod],
});

decorateMethod(TasksController.prototype, "getChannel", TasksNest.responses("warn"));
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

  hello() {
    return { hello: "world" };
  }
}

Get("own/hello")(
  OwnController.prototype,
  "hello",
  Object.getOwnPropertyDescriptor(OwnController.prototype, "hello"),
);
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

// The app module provides its global interceptor, which NestJS registers before the imported api's reply interceptor.
Module({
  imports: [TasksNest.SeampactModule.forRoot(hooks)],
  controllers: [TasksController, OwnController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: RecordingInterceptor }],
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

// Initialises and closes an app of the given module; resolves once initialised, rejects with its boot problems.
async function bootOnce(module) {
  const app = await NestFactory.create(module, { rawBody: true, logger: recordingLogger });

  try {
    await app.init();
  } finally {
    await app.close();
  }
}

function moduleOf(imports, controllers, providers = []) {
  class BootModule {}

  Module({ imports, controllers, providers })(BootModule);

  return BootModule;
}

function controllerOf(aboveComposite = {}, withoutInput = []) {
  const BootController = tasksController(aboveComposite, withoutInput);

  Controller()(BootController);

  return BootController;
}

/** Boots an app with a cache interceptor on `health`, one that skips contract routes or not. */
export function bootWithCacheInterceptor(skipsContractRoutes) {
  const controller = controllerOf({
    health: [UseInterceptors(cacheInterceptor(skipsContractRoutes))],
  });

  return bootOnce(moduleOf([TasksNest.SeampactModule.forRoot(hooks)], [controller]));
}

/** Boots an app whose `health` route carries a request-scoped interceptor. */
export function bootWithRequestScopedInterceptor() {
  class ScopedInterceptor extends PassThroughInterceptor {}

  Injectable({ scope: Scope.REQUEST })(ScopedInterceptor);

  const controller = controllerOf({ health: [UseInterceptors(ScopedInterceptor)] });

  return bootOnce(moduleOf([TasksNest.SeampactModule.forRoot(hooks)], [controller]));
}

/** Boots an app whose `health` method declares no input param. */
export function bootWithoutInputParam() {
  return bootOnce(
    moduleOf([TasksNest.SeampactModule.forRoot(hooks)], [controllerOf({}, ["health"])]),
  );
}

/** Boots an app with a module whose `configure`, after seampact's, empties the guards of `health`. */
export function bootWithoutGuard() {
  const controller = controllerOf();

  class ClearGuardsModule {
    configure() {
      Reflect.defineMetadata("__guards__", [], controller.prototype.health);
    }
  }

  Module({})(ClearGuardsModule);

  return bootOnce(
    moduleOf([TasksNest.SeampactModule.forRoot(hooks), ClearGuardsModule], [controller]),
  );
}

/** Boots an app with a module whose `configure`, after seampact's, appends a guard to `health`. */
export function bootWithLateGuard() {
  const controller = controllerOf();

  class LateGuardModule {
    configure() {
      const health = controller.prototype.health;
      const guards = Reflect.getMetadata("__guards__", health) ?? [];

      Reflect.defineMetadata("__guards__", [...guards, LateGuard], health);
    }
  }

  Module({})(LateGuardModule);

  return bootOnce(
    moduleOf([TasksNest.SeampactModule.forRoot(hooks), LateGuardModule], [controller]),
  );
}

/** Boots an app with a module whose `configure`, after seampact's, puts a global interceptor in front of the list. */
export function bootWithLateGlobalInterceptor() {
  class LateInterceptorModule {
    constructor(applicationConfig) {
      this.applicationConfig = applicationConfig;
    }

    configure() {
      this.applicationConfig.getGlobalInterceptors().unshift(new LateGlobalInterceptor());
    }
  }

  Inject(ApplicationConfig)(LateInterceptorModule, undefined, 0);
  Module({})(LateInterceptorModule);

  return bootOnce(
    moduleOf([TasksNest.SeampactModule.forRoot(hooks), LateInterceptorModule], [controllerOf()]),
  );
}

/** Boots an app with the given `forRoot` options. */
export function bootWithModuleOptions(moduleOptions) {
  return bootOnce(
    moduleOf([TasksNest.SeampactModule.forRoot(hooks, moduleOptions)], [controllerOf()]),
  );
}

/** Boots an app that imports the api's module twice, with two hook objects. */
export function bootTwice() {
  return bootOnce(
    moduleOf(
      [TasksNest.SeampactModule.forRoot(hooks), TasksNest.SeampactModule.forRoot({ ...hooks })],
      [TasksController],
    ),
  );
}

/** Boots an app whose controller carries a controller interceptor, a route interceptor on `health`, and whose app
 * module provides a global interceptor. */
export function bootWithAppInterceptors() {
  const controller = controllerOf({ health: [UseInterceptors(PassThroughInterceptor)] });

  UseInterceptors(new ControllerWideInterceptor())(controller);

  return bootOnce(
    moduleOf(
      [TasksNest.SeampactModule.forRoot(hooks)],
      [controller],
      [{ provide: APP_INTERCEPTOR, useClass: AppModuleInterceptor }],
    ),
  );
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
  app.useGlobalPipes(new TamperingPipe());
  await app.listen(0, "127.0.0.1");

  const { port } = app.getHttpServer().address();
  const globalInterceptors = app
    .get(ApplicationConfig)
    .getGlobalInterceptors()
    .map((interceptor) => interceptor.constructor.name);

  return { host: "127.0.0.1", port, globalInterceptors, close: () => app.close() };
}
