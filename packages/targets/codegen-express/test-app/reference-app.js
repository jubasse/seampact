// An Express app around the generated `tasks` router, for the live boundary test: the shared scenario's handler map
// and hooks, app middleware before the router, an app error middleware, routes of the app's own and a router
// mounted under a path; and an app with two apis on one base path. Copied next to the compiled generated tree, so
// it imports the generated modules by relative path. The test links `express` to the major it runs.
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

  return listen(app);
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
