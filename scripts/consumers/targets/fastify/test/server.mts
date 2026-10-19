// Registers both apis' generated plugins on a Fastify app with `@fastify/compress`, the tasks plugin under its base
// path as prefix, beside the http suite's control routes, with the not-found handler and `frameworkErrors` that
// answer the requests the plugins never see in each api's format, on a free local port. The app collects its routes
// first, for the plugins' framework-route check at ready.
import compress from "@fastify/compress";
import { HOOK_CALLS_ROUTE, LOG_LINES_ROUTE, SCRIPT_ROUTE } from "@seampact/http-suite";
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import * as TasksFastify from "../generated/server/tasks/index.js";
import * as TasksServiceFastify from "../generated/server/tasksService/index.js";
import {
  servesUnlistedRoute,
  UNLISTED_ROUTE,
  withoutMissingHandler,
} from "../src/boot-variant.mjs";
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
const NOT_FOUND_STATUS = 404;
const INTERNAL_STATUS = 500;
// The base path every route of the tasks api sits under, which the plugin accepts as its registration prefix.
const TASKS_BASE_PATH = "/v1";

// Each api's helper first; false when the request is on no contract path.
function renderedByAnApi(request: FastifyRequest, reply: FastifyReply, error?: Error): boolean {
  return (
    TasksFastify.renderPreRoutingError(request, reply, error) ||
    TasksServiceFastify.renderPreRoutingError(request, reply, error)
  );
}

function sendControlReply(reply: FastifyReply, controlReply: ControlReply): FastifyReply {
  return reply.code(controlReply.status).send(controlReply.body);
}

/** The tasks plugin's handlers and hooks, without a prefix. */
export function tasksRegistration() {
  return {
    handlers: withoutMissingHandler({
      AppEndpoints: tasksHandlers,
      ChannelsEndpoints: tasksHandlers,
      TasksEndpoints: tasksHandlers,
      DraftsEndpoints: tasksHandlers,
      PreferencesEndpoints: tasksHandlers,
      HooksEndpoints: tasksHandlers,
    }),
    hooks: tasksHooks(),
  };
}

export async function startServer(): Promise<RunningServer> {
  const app = Fastify({
    frameworkErrors(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
      if (renderedByAnApi(request, reply, error)) return;

      reply.code(error.statusCode ?? INTERNAL_STATUS).send({ message: error.message });
    },
  });

  TasksFastify.collectFrameworkRoutes(app);
  await app.register(compress);
  app.put(SCRIPT_ROUTE, (request, reply) => sendControlReply(reply, loadScriptReply(request.body)));
  app.get(HOOK_CALLS_ROUTE, (_request, reply) => sendControlReply(reply, hookCallsReply()));
  app.get(LOG_LINES_ROUTE, (_request, reply) => sendControlReply(reply, logLinesReply()));

  if (servesUnlistedRoute()) app.get(UNLISTED_ROUTE, (_request, reply) => reply.code(204).send());

  app.setNotFoundHandler((request, reply) => {
    if (renderedByAnApi(request, reply)) return;

    reply.code(NOT_FOUND_STATUS).send({ message: "not found" });
  });
  await app.register(TasksFastify.plugin, { prefix: TASKS_BASE_PATH, ...tasksRegistration() });
  await app.register(TasksServiceFastify.plugin, {
    handlers: { InternalEndpoints: tasksServiceHandlers },
    hooks: tasksServiceHooks(),
  });
  await app.listen({ port: 0, host: HOST });

  const address = app.server.address();

  if (address === null || typeof address === "string") {
    throw new Error(`The Fastify app listens on ${String(address)}, not on a TCP port.`);
  }

  return { baseUrl: `http://${HOST}:${address.port}`, close: () => app.close() };
}
