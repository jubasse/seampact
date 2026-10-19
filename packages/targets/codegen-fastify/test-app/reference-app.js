// A Fastify app around the generated `tasks` plugin, for the live boundary test: the shared scenario's handler map
// and hooks, an app root hook, an app error handler, a not-found handler and `frameworkErrors` that call the
// exported helper, and routes of the app's own; an app with the plugin under a prefix; and an app with two apis on
// one base path. Copied next to the compiled generated tree, so it imports the generated modules by relative path.
import Fastify from "fastify";
import * as TasksFastify from "../generated/server/tasks/index.js";
import * as SecondFastify from "../generated/server/tasksService/index.js";
import {
  ALLOWED_ORIGIN,
  AppReply,
  calls,
  FAIL_BEFORE_HEADER,
  handlers,
  hooks,
  resetScenario,
} from "./reference-scenario.js";

export * from "./reference-scenario.js";

const INTERNAL_STATUS = 500;
const NOT_FOUND_STATUS = 404;

// The `writeHead` form passes its headers as an argument, an ETag included, as some frameworks do.
function writeAppReply(error, reply) {
  if (error.encoding !== undefined) {
    reply
      .code(error.status)
      .type(error.contentType)
      .header("content-encoding", error.encoding)
      .send(error.encodedBody);

    return;
  }

  if (error.writer === "writeHead") {
    reply.hijack();
    reply.raw
      .writeHead(error.status, { "content-type": error.contentType, etag: '"app-etag"' })
      .end(error.body);

    return;
  }

  reply.code(error.status).type(error.contentType).send(error.body);
}

/** A fresh instance with the plugin registered with these options, for the boot check; resolves once ready. */
export async function bootWith(registrationOptions, instanceOptions = {}, prefix = undefined) {
  const app = Fastify(instanceOptions);

  await app.register(TasksFastify.plugin, {
    ...registrationOptions,
    ...(prefix === undefined ? {} : { prefix }),
  });
  await app.ready();
  await app.close();
}

/** A fresh instance with the plugin registered twice; resolves once ready. */
export async function bootTwice(registrationOptions) {
  const app = Fastify();

  await app.register(TasksFastify.plugin, registrationOptions);
  await app.register(TasksFastify.plugin, registrationOptions);
  await app.ready();
  await app.close();
}

/** Builds an app registering the `tasks` plugin under the given prefix; listens on a free port. */
export async function startPrefixedApp(prefix) {
  resetScenario();

  const app = Fastify();

  await app.register(TasksFastify.plugin, { handlers, hooks, prefix });
  await app.listen({ port: 0, host: "127.0.0.1" });

  const { port } = app.server.address();

  return { host: "127.0.0.1", port, close: () => app.close() };
}

/** Builds the app and listens on a free port. */
export async function startReferenceApp() {
  resetScenario();

  const app = Fastify({
    frameworkErrors(error, request, reply) {
      if (TasksFastify.renderPreRoutingError(request, reply, error)) return;

      reply.code(error.statusCode ?? INTERNAL_STATUS).send({ message: error.message });
    },
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.headers.origin === ALLOWED_ORIGIN) {
      reply.header("access-control-allow-origin", ALLOWED_ORIGIN);
      reply.header("vary", "Origin");
    }

    reply.header("strict-transport-security", "max-age=63072000");
    reply.header("x-content-type-options", "nosniff");

    const failure = request.headers[FAIL_BEFORE_HEADER];

    if (typeof failure === "string") {
      throw Object.assign(new Error("refused by an app root hook"), {
        statusCode: Number(failure),
      });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppReply) {
      writeAppReply(error, reply);

      return;
    }

    calls.loggedErrors.push(String(error?.stack ?? error));
    reply.code(error?.statusCode ?? INTERNAL_STATUS).send({ message: String(error?.message) });
  });
  app.setNotFoundHandler((request, reply) => {
    if (TasksFastify.renderPreRoutingError(request, reply)) return;

    reply.code(NOT_FOUND_STATUS).send({ message: "not found" });
  });
  await app.register(TasksFastify.plugin, {
    handlers,
    hooks,
    operations: { getChannel: { responses: "warn" } },
  });
  app.get("/own/boom", async () => {
    throw new Error("own boom");
  });
  app.post("/own/echo", async (request) => request.body);
  await app.listen({ port: 0, host: "127.0.0.1" });

  const { port } = app.server.address();

  return { host: "127.0.0.1", port, close: () => app.close() };
}

/**
 * Builds an app registering the `tasks` plugin and, after it, the plugin of the api the test generated in the
 * `tasksService` slot, on the same base paths; listens on a free port.
 */
export async function startTwoApiApp() {
  resetScenario();

  const app = Fastify();

  app.setNotFoundHandler((request, reply) => {
    if (TasksFastify.renderPreRoutingError(request, reply)) return;

    if (SecondFastify.renderPreRoutingError(request, reply)) return;

    reply.code(NOT_FOUND_STATUS).send({ message: "not found" });
  });
  await app.register(TasksFastify.plugin, { handlers, hooks });
  await app.register(SecondFastify.plugin, { handlers, hooks });
  await app.listen({ port: 0, host: "127.0.0.1" });

  const { port } = app.server.address();

  return { host: "127.0.0.1", port, close: () => app.close() };
}
