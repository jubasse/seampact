// Registers both apis' generated plugins on a Fastify app, with the not-found handler and `frameworkErrors` that
// answer the requests the plugins never see in each api's format, on a free local port.
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import * as TasksFastify from "../generated/server/tasks/index.js";
import * as TasksServiceFastify from "../generated/server/tasksService/index.js";
import { tasksHandlers, tasksServiceHandlers } from "../src/handlers.mjs";
import { tasksHooks, tasksServiceHooks } from "../src/hooks.mjs";

export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";
const NOT_FOUND_STATUS = 404;
const INTERNAL_STATUS = 500;

// Each api's helper first; false when the request is on no contract path.
function renderedByAnApi(request: FastifyRequest, reply: FastifyReply, error?: Error): boolean {
  return (
    TasksFastify.renderPreRoutingError(request, reply, error) ||
    TasksServiceFastify.renderPreRoutingError(request, reply, error)
  );
}

export async function startServer(): Promise<RunningServer> {
  const app = Fastify({
    frameworkErrors(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
      if (renderedByAnApi(request, reply, error)) return;

      reply.code(error.statusCode ?? INTERNAL_STATUS).send({ message: error.message });
    },
  });

  app.setNotFoundHandler((request, reply) => {
    if (renderedByAnApi(request, reply)) return;

    reply.code(NOT_FOUND_STATUS).send({ message: "not found" });
  });
  await app.register(TasksFastify.plugin, {
    handlers: {
      AppEndpoints: tasksHandlers,
      ChannelsEndpoints: tasksHandlers,
      TasksEndpoints: tasksHandlers,
      DraftsEndpoints: tasksHandlers,
      PreferencesEndpoints: tasksHandlers,
      HooksEndpoints: tasksHandlers,
    },
    hooks: tasksHooks(),
  });
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
