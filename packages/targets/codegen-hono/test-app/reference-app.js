// A Hono app around the generated `tasks` registration, for the live boundary test: the shared scenario's handler
// map and hooks, app middleware before the api (headers, a refusal, a body read, a reply rewrite after `next()`), an
// `onError` that calls the exported helpers, and routes of the app's own; an app with two apis on one base path;
// and the boot cases. Copied next to the compiled generated tree, so it imports the generated modules by relative
// path.
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { HTTPException } from "hono/http-exception";
import * as TasksHono from "../generated/server/tasks/index.js";
import * as SecondHono from "../generated/server/tasksService/index.js";
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

/** A request carrying this header has its body read by app middleware before the boundary. */
export const READ_BODY_HEADER = "x-read-body-before";

/** A request carrying this header has its reply replaced by app middleware after `next()`. */
export const REWRITE_REPLY_HEADER = "x-rewrite-reply";

/**
 * A request carrying this header has the boundary's reply relabelled by app middleware after `next()`: `content-type`
 * or `content-encoding` with `c.header()`, which rebuilds the reply around its body, or `in-place` on `c.res.headers`.
 */
export const RELABEL_REPLY_HEADER = "x-relabel-reply";

const HOST = "127.0.0.1";
const INTERNAL_STATUS = 500;
const NOT_FOUND_STATUS = 404;

// The `writeHead` writer passes a framework ETag, which the check strips.
function appReplyResponse(error) {
  const headers = { "content-type": error.contentType };

  if (error.encoding !== undefined) {
    return new Response(error.encodedBody, {
      status: error.status,
      headers: { ...headers, "content-encoding": error.encoding },
    });
  }

  if (error.writer === "writeHead") headers.etag = '"app-etag"';

  return new Response(error.body, { status: error.status, headers });
}

function relabelReply(c, relabelling) {
  if (relabelling === "in-place") {
    c.res.headers.set("content-type", "text/html");
    c.res.headers.set("etag", '"app-etag"');

    return;
  }

  if (relabelling === "content-type") c.header("content-type", "text/html");

  if (relabelling === "content-encoding") c.header("content-encoding", "gzip");

  if (relabelling !== undefined) c.header("x-after-next", "kept");
}

function referenceApp(registration) {
  const app = new Hono();

  app.use(compress());
  app.use(async (c, next) => {
    if (c.req.header("origin") === ALLOWED_ORIGIN) {
      c.header("access-control-allow-origin", ALLOWED_ORIGIN);
      c.header("vary", "Origin");
    }

    c.header("strict-transport-security", "max-age=63072000");
    c.header("x-content-type-options", "nosniff");

    const failure = c.req.header(FAIL_BEFORE_HEADER);

    if (failure !== undefined) {
      throw new HTTPException(Number(failure), { message: "refused by app middleware" });
    }

    if (c.req.header(READ_BODY_HEADER) !== undefined) await c.req.text();

    await next();

    relabelReply(c, c.req.header(RELABEL_REPLY_HEADER));

    if (c.req.header(REWRITE_REPLY_HEADER) !== undefined) {
      c.res = new Response("rewritten", {
        status: NOT_FOUND_STATUS,
        headers: { "content-type": "text/plain" },
      });
    }
  });
  app.onError(async (error, c) => {
    const preRouting = await TasksHono.renderPreRoutingError(c, error);

    if (preRouting !== undefined) return preRouting;

    if (error instanceof AppReply) return appReplyResponse(error);

    calls.loggedErrors.push(String(error?.stack ?? error));

    return c.json({ message: String(error?.message) }, error?.status ?? INTERNAL_STATUS);
  });
  app.notFound((c) => c.json({ message: "not found" }, NOT_FOUND_STATUS));
  TasksHono.registerRoutes(app, registration);
  app.get("/own/boom", () => {
    throw new Error("own boom");
  });
  app.post("/own/echo", async (c) => c.json(await c.req.json()));

  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: HOST }, (info) => {
      resolve({
        host: HOST,
        port: info.port,
        close: () =>
          new Promise((closed, failed) => {
            server.closeAllConnections();
            server.close((error) => (error === undefined ? closed() : failed(error)));
          }),
      });
    });
  });
}

/** Registers the api on a fresh app, under `basePath` when given; throws the boot check's problems. */
export function bootWith(registrationOptions, basePath = undefined) {
  const app = new Hono();

  TasksHono.registerRoutes(
    basePath === undefined ? app : app.basePath(basePath),
    registrationOptions,
  );
}

/** Registers the api twice on one app; throws the boot check's problems. */
export function bootTwice(registrationOptions) {
  const app = new Hono();

  TasksHono.registerRoutes(app, registrationOptions);
  TasksHono.registerRoutes(app, registrationOptions);
}

/** A request through `app.request()` of an app registered as the served one. */
export function requestThroughApp(path, init) {
  return referenceApp({ handlers, hooks }).request(path, init);
}

/** A request to a root app serving the api from a sub-app mounted with `app.route()`. */
export function requestThroughSubApp(path, init) {
  const subApp = new Hono();
  const root = new Hono();

  TasksHono.registerRoutes(subApp, { handlers, hooks });
  root.route("/", subApp);

  return root.request(path, init);
}

/** Builds the app and listens on a free port. */
export function startReferenceApp() {
  resetScenario();

  return listen(
    referenceApp({
      handlers,
      hooks,
      operations: { getChannel: { responses: "warn" } },
      clientAddress: (c) => getConnInfo(c).remote.address,
    }),
  );
}

/**
 * Builds an app registering the `tasks` api and, after it, the api the test generated in the `tasksService` slot,
 * on the same base paths; listens on a free port.
 */
export function startTwoApiApp() {
  resetScenario();

  const app = new Hono();

  app.notFound((c) => c.json({ message: "not found" }, NOT_FOUND_STATUS));
  TasksHono.registerRoutes(app, { handlers, hooks });
  SecondHono.registerRoutes(app, { handlers, hooks });

  return listen(app);
}
