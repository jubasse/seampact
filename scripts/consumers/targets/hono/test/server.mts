// Registers both apis' generated routes on a Hono app served by `@hono/node-server`, after `hono/cors`,
// `hono/compress` and the http suite's control routes, with an `onError` that answers the refusals app middleware
// raises before them in each api's format, on a free local port.
import { type ServerType, serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { HOOK_CALLS_ROUTE, LOG_LINES_ROUTE, SCRIPT_ROUTE } from "@seampact/http-suite";
import { type Context, Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import * as TasksHono from "../generated/server/tasks/index.js";
import * as TasksServiceHono from "../generated/server/tasksService/index.js";
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
const INTERNAL_STATUS = 500;

function clientAddress(c: Context): string | undefined {
  return getConnInfo(c).remote.address;
}

// Each api's helper first; undefined when the error is no contract refusal raised before a contract route.
async function renderedByAnApi(c: Context, error: Error): Promise<Response | undefined> {
  return (
    (await TasksHono.renderPreRoutingError(c, error)) ??
    (await TasksServiceHono.renderPreRoutingError(c, error))
  );
}

export async function startServer(): Promise<RunningServer> {
  const app = new Hono();

  app.use(cors());
  app.use(compress());
  app.onError(
    async (error, c) =>
      (await renderedByAnApi(c, error)) ?? c.json({ message: error.message }, INTERNAL_STATUS),
  );
  app.put(SCRIPT_ROUTE, async (c) => controlResponse(loadScriptReply(await c.req.json())));
  app.get(HOOK_CALLS_ROUTE, () => controlResponse(hookCallsReply()));
  app.get(LOG_LINES_ROUTE, () => controlResponse(logLinesReply()));
  TasksHono.registerRoutes(app, {
    handlers: withoutMissingHandler({
      AppEndpoints: tasksHandlers,
      ChannelsEndpoints: tasksHandlers,
      TasksEndpoints: tasksHandlers,
      DraftsEndpoints: tasksHandlers,
      PreferencesEndpoints: tasksHandlers,
      HooksEndpoints: tasksHandlers,
    }),
    hooks: tasksHooks(),
    clientAddress,
  });
  TasksServiceHono.registerRoutes(app, {
    handlers: { InternalEndpoints: tasksServiceHandlers },
    hooks: tasksServiceHooks(),
    clientAddress,
  });

  const { server, port } = await listening(app);

  return {
    baseUrl: `http://${HOST}:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function controlResponse(reply: ControlReply): Response {
  if (reply.body === undefined) return new Response(null, { status: reply.status });

  return Response.json(reply.body, { status: reply.status });
}

function listening(app: Hono): Promise<{ server: ServerType; port: number }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: HOST }, (info) =>
      resolve({ server, port: info.port }),
    );
  });
}
