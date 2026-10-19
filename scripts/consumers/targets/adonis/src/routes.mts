// The consumer's start/routes: the http suite's control routes, the framework-route boot variants' route, and both
// apis' routes with the shared hooks, each controller imported lazily.
import type { HttpContext, Router } from "@adonisjs/core/http";
import { HOOK_CALLS_ROUTE, LOG_LINES_ROUTE, SCRIPT_ROUTE } from "@seampact/http-suite";
import * as TasksAdonis from "../generated/server/tasks/index.js";
import * as TasksServiceAdonis from "../generated/server/tasksService/index.js";
import { servesUnlistedRoute, UNLISTED_ROUTE, withoutMissingHandler } from "./boot-variant.mjs";
import { tasksHooks, tasksServiceHooks } from "./hooks.mjs";
import {
  type ControlReply,
  hookCallsReply,
  loadScriptReply,
  logLinesReply,
} from "./suite-control.mjs";

const controllers = () => import("./controllers.mjs");

export function registerContractRoutes(router: Router): void {
  router.put(SCRIPT_ROUTE, ({ request, response }) =>
    sendControlReply(response, loadScriptReply(request.body())),
  );
  router.get(HOOK_CALLS_ROUTE, ({ response }) => sendControlReply(response, hookCallsReply()));
  router.get(LOG_LINES_ROUTE, ({ response }) => sendControlReply(response, logLinesReply()));

  if (servesUnlistedRoute())
    router.get(UNLISTED_ROUTE, ({ response }) => response.status(204).send(""));

  TasksAdonis.registerRoutes(router, {
    controllers: withoutMissingHandler({
      AppEndpoints: async () => ({ default: (await controllers()).AppController }),
      ChannelsEndpoints: async () => ({ default: (await controllers()).ChannelsController }),
      TasksEndpoints: async () => ({ default: (await controllers()).TasksController }),
      DraftsEndpoints: async () => ({ default: (await controllers()).DraftsController }),
      PreferencesEndpoints: async () => ({ default: (await controllers()).PreferencesController }),
      HooksEndpoints: async () => ({ default: (await controllers()).HooksController }),
    }),
    hooks: tasksHooks(),
  });

  TasksServiceAdonis.registerRoutes(router, {
    controllers: {
      InternalEndpoints: async () => ({ default: (await controllers()).InternalController }),
    },
    hooks: tasksServiceHooks(),
  });
}

function sendControlReply(response: HttpContext["response"], reply: ControlReply): void {
  if (reply.body === undefined) response.status(reply.status).send("");
  else response.status(reply.status).json(reply.body);
}
