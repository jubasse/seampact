// Mounts both apis' generated routers at the root of an Express app, after the http suite's control routes and
// with the exported error middleware for refusals raised before them, on a free local port. The `express4` overlay
// runs the same app on Express 4.
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { HOOK_CALLS_ROUTE, LOG_LINES_ROUTE, SCRIPT_ROUTE } from "@seampact/http-suite";
import express, { type Response } from "express";
import * as TasksExpress from "../generated/server/tasks/index.js";
import * as TasksServiceExpress from "../generated/server/tasksService/index.js";
import { withoutMissingHandler } from "../src/boot-variant.mjs";
import { tasksHandlers, tasksServiceHandlers } from "../src/handlers.mjs";
import { tasksHooks, tasksServiceHooks } from "../src/hooks.mjs";
import {
  type ControlReply,
  hookCallsReply,
  loadScriptReply,
  logLinesReply,
} from "../src/suite-control.mjs";

export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";

export async function startServer(): Promise<RunningServer> {
  const app = express();

  app.put(SCRIPT_ROUTE, express.json(), (request, response) =>
    sendControlReply(response, loadScriptReply(request.body)),
  );
  app.get(HOOK_CALLS_ROUTE, (_request, response) => sendControlReply(response, hookCallsReply()));
  app.get(LOG_LINES_ROUTE, (_request, response) => sendControlReply(response, logLinesReply()));
  app.use(
    TasksExpress.router({
      handlers: withoutMissingHandler({
        AppEndpoints: tasksHandlers,
        ChannelsEndpoints: tasksHandlers,
        TasksEndpoints: tasksHandlers,
        DraftsEndpoints: tasksHandlers,
        PreferencesEndpoints: tasksHandlers,
        HooksEndpoints: tasksHandlers,
      }),
      hooks: tasksHooks(),
    }),
  );
  app.use(
    TasksServiceExpress.router({
      handlers: { InternalEndpoints: tasksServiceHandlers },
      hooks: tasksServiceHooks(),
    }),
  );
  app.use(TasksExpress.preRoutingErrorHandler);
  app.use(TasksServiceExpress.preRoutingErrorHandler);

  const server = app.listen(0, HOST);

  await once(server, "listening");

  return {
    baseUrl: `http://${HOST}:${portOf(server.address())}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function sendControlReply(response: Response, reply: ControlReply): void {
  if (reply.body === undefined) response.status(reply.status).end();
  else response.status(reply.status).json(reply.body);
}

function portOf(address: AddressInfo | string | null): number {
  if (address === null || typeof address === "string") {
    throw new Error(`The Express app listens on ${String(address)}, not on a TCP port.`);
  }

  return address.port;
}
