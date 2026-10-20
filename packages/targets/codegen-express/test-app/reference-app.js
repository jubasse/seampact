// An Express app around the generated `tasks` router, for the live boundary test: the shared scenario's handler map
// and hooks, app middleware before the router, an app error middleware, routes of the app's own and a router
// mounted under a path with hooks of its own; an app with the router nested in a parent router, one without a
// router; an app with two apis on one base path; apps that never call the framework-route check, one in a sub-app;
// and apps with a route of their own the check refuses. Copied next to the compiled generated tree, so it imports
// the generated modules by relative path. The test links `express` to the major it runs.
import express from "express";
import * as TasksExpress from "../generated/server/tasks/index.js";
import * as SecondExpress from "../generated/server/tasksService/index.js";
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

/** The message of the error an app route renders with `renderContractError`, outside any request context. */
export const APP_RENDERED_ERROR = "rendered by an app route";
/** What the hooks of the router mounted under a path saw: none of the root router's reports. */
export const mountedRouterUnexpected = [];

// The router mounted under a path is made last, with hooks of its own.
const mountedRouterHooks = {
  ...hooks,
  onUnexpectedError(exceptionOrReply) {
    mountedRouterUnexpected.push(exceptionOrReply);
  },
};

// The route's own body limit: a lower app parser limit is a setup error, not the client's 413.
const APP_PARSER_LIMIT = "1mb";

/** What the hooks of the router nested in a parent router saw. */
export const nestedRouterUnexpected = [];

const nestedRouterHooks = {
  ...hooks,
  onUnexpectedError(exceptionOrReply) {
    nestedRouterUnexpected.push(exceptionOrReply);
  },
};

// The `writeHead` form passes its headers as an argument, an ETag included, as some frameworks do.
function appReplyMiddleware(error, _request, response, next) {
  if (!(error instanceof AppReply)) {
    next(error);

    return;
  }

  if (error.encoding !== undefined) {
    response
      .status(error.status)
      .type(error.contentType)
      .set("content-encoding", error.encoding)
      .end(error.encodedBody);

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

    failBeforeOnDemand(request, response, next);
  });
  app.use(
    TasksExpress.router({ handlers, hooks, operations: { getChannel: { responses: "warn" } } }),
  );
  app.use("/mounted", TasksExpress.router({ handlers, hooks: mountedRouterHooks }));
  app.get("/own/render-error", renderWithoutAwait);
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

  return listen(app);
}

/**
 * Builds an app whose `tasks` router sits in a parent router mounted at the root, with hooks of its own, an app
 * middleware that fails before it on demand, an app body parser at the route's limit, and an app route that renders an error without awaiting it; listens
 * on a free port.
 */
export async function startNestedRouterApp() {
  const app = express();
  const parentRouter = express.Router();

  app.use(failBeforeOnDemand);
  app.use(express.json({ limit: APP_PARSER_LIMIT }));
  parentRouter.use(TasksExpress.router({ handlers, hooks: nestedRouterHooks }));
  app.use(parentRouter);
  app.get("/own/render-error", renderWithoutAwait);
  app.use(TasksExpress.preRoutingErrorHandler);

  return listen(app);
}

/** Builds an app that mounts no `tasks` router but renders its errors; listens on a free port. */
export async function startRouterlessApp() {
  const app = express();

  app.get("/own/render-error", renderWithoutAwait);

  return listen(app);
}

// As an app may write it: the promise is dropped, so a rejection would be unhandled.
function renderWithoutAwait(_request, response) {
  TasksExpress.renderContractError(response, new Error(APP_RENDERED_ERROR));
}

function failBeforeOnDemand(request, _response, next) {
  const failure = request.headers[FAIL_BEFORE_HEADER];

  if (typeof failure === "string") {
    next(Object.assign(new Error("refused before the router"), { status: Number(failure) }));

    return;
  }

  next();
}

/**
 * Builds an app serving the `tasks` router and, after it, the router of the api the test generated in the
 * `tasksService` slot, on the same base paths; listens on a free port.
 */
export async function startTwoApiApp() {
  resetScenario();

  const app = express();

  app.use(TasksExpress.router({ handlers, hooks }));
  app.use(SecondExpress.router({ handlers, hooks }));

  return listen(app);
}

/** The app's own route the framework-route test allow-lists, and one it does not. */
export const LISTED_OWN_ROUTE = "/own/listed";
export const UNLISTED_OWN_ROUTE = "/own/unlisted";

/**
 * Builds an app serving the `tasks` router and an allow-listed route of its own, plus an unlisted one when asked,
 * that never calls checkFrameworkRoutes; listens on a free port.
 */
export async function startUncheckedApp({ withUnlistedRoute }) {
  resetScenario();

  const app = express();

  app.get(LISTED_OWN_ROUTE, (_request, response) => response.send("listed"));

  if (withUnlistedRoute)
    app.get(UNLISTED_OWN_ROUTE, (_request, response) => response.send("unlisted"));

  app.use(TasksExpress.router({ handlers, hooks }));

  return listen(app);
}

/** Builds an app serving the `tasks` router with no hook registered at all; listens on a free port. */
export async function startAppWithoutHooks() {
  resetScenario();

  const app = express();

  app.use(TasksExpress.router({ handlers, hooks: {} }));

  return listen(app);
}

/** Makes the `tasks` router with no hook registered and the given logger, to see how the boot check answers. */
export function makeRouterWithoutHooks(logger) {
  return TasksExpress.router({ handlers, hooks: {}, logger });
}

/** Makes the `tasks` router with two deciders claiming one right, to see that no hook level lets it boot. */
export function makeRouterWithDoubleClaim(logger) {
  const decider = { decide: () => ({ allow: true }) };

  return TasksExpress.router({
    handlers,
    hooks: {
      deciders: [
        { names: ["tasks.double"], decider },
        { names: ["tasks.double"], decider },
      ],
    },
    logger,
  });
}

async function listen(app) {
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

/**
 * Builds an app with a route of its own at `ownPath`, registered before the `tasks` router, and runs the
 * framework-route check over it; throws the check's refusal.
 */
export function checkAppWithOwnRoute(ownPath) {
  resetScenario();

  const app = express();

  app.get(ownPath, (_request, response) => response.send("own"));
  app.use(TasksExpress.router({ handlers, hooks }));
  TasksExpress.checkFrameworkRoutes(app);
}

/**
 * Builds an app that mounts, at its root, a sub-app serving the `tasks` router, beside an unlisted route of its
 * own; never calls checkFrameworkRoutes; listens on a free port.
 */
export async function startUncheckedSubApp() {
  resetScenario();

  const app = express();
  const subApp = express();

  subApp.use(TasksExpress.router({ handlers, hooks }));
  app.get(UNLISTED_OWN_ROUTE, (_request, response) => response.send("unlisted"));
  app.use(subApp);

  return listen(app);
}
