// The consumer's start/routes: the http suite's control routes, the framework-route boot variants' route, and each
// api's routes with the shared hooks, each controller imported lazily.
import type { HttpContext, Router } from "@adonisjs/core/http";
import { HOOK_CALLS_ROUTE, LOG_LINES_ROUTE, SCRIPT_ROUTE } from "@seampact/http-suite";
import * as TasksAdonis from "../generated/server/tasks/index.js";
import * as TasksDevicesAdonis from "../generated/server/tasksDevices/index.js";
import * as TasksResponsesAdonis from "../generated/server/tasksResponses/index.js";
import * as TasksPagingAdonis from "../generated/server/tasksPaging/index.js";
import * as TasksServiceAdonis from "../generated/server/tasksService/index.js";
import * as TasksServiceWritesAdonis from "../generated/server/tasksServiceWrites/index.js";
import {
  MISMATCHED_MOUNT,
  mountsUnderMismatchedPrefix,
  PATTERNED_ROUTE,
  servesPatternedRoute,
  servesUnlistedRoute,
  UNLISTED_ROUTE,
  withoutMissingHandler,
} from "./boot-variant.mjs";
import {
  tasksDevicesHooks,
  tasksHooks,
  tasksServiceHooks,
  tasksServiceWritesHooks,
} from "./hooks.mjs";
import { tasksResponsesHooks } from "./responses-handlers.mjs";
import { tasksPagingHooks } from "./paging-handlers.mjs";
import {
  type ControlReply,
  hookCallsReply,
  loadScriptReply,
  logLinesReply,
} from "./suite-control.mjs";

const controllers = () => import("./controllers.mjs");
const responsesControllers = () => import("./responses-controllers.mjs");
const pagingControllers = () => import("./paging-controllers.mjs");

export function registerContractRoutes(router: Router): void {
  router.put(SCRIPT_ROUTE, ({ request, response }) =>
    sendControlReply(response, loadScriptReply(request.body())),
  );
  router.get(HOOK_CALLS_ROUTE, ({ response }) => sendControlReply(response, hookCallsReply()));
  router.get(LOG_LINES_ROUTE, ({ response }) => sendControlReply(response, logLinesReply()));

  if (servesUnlistedRoute())
    router.get(UNLISTED_ROUTE, ({ response }) => response.status(204).send(""));

  if (servesPatternedRoute())
    router.get(PATTERNED_ROUTE, ({ response }) => response.status(204).send(""));

  if (mountsUnderMismatchedPrefix())
    router.group(() => registerTasksRoutes(router)).prefix(MISMATCHED_MOUNT);
  else registerTasksRoutes(router);

  TasksServiceAdonis.registerRoutes(router, {
    controllers: {
      InternalEndpoints: async () => ({ default: (await controllers()).InternalController }),
    },
    hooks: tasksServiceHooks(),
  });

  TasksServiceWritesAdonis.registerRoutes(router, {
    controllers: {
      InternalWritesEndpoints: async () => ({
        default: (await controllers()).InternalWritesController,
      }),
    },
    hooks: tasksServiceWritesHooks(),
  });

  TasksDevicesAdonis.registerRoutes(router, {
    controllers: {
      DevicesEndpoints: async () => ({ default: (await controllers()).DevicesController }),
    },
    hooks: tasksDevicesHooks(),
  });

  TasksResponsesAdonis.registerRoutes(router, {
    controllers: {
      ResponsesEndpoints: async () => ({
        default: (await responsesControllers()).ResponsesController,
      }),
      NotesEndpoints: async () => ({ default: (await responsesControllers()).NotesController }),
    },
    hooks: tasksResponsesHooks(),
  });

  TasksPagingAdonis.registerRoutes(router, {
    controllers: {
      NotesEndpoints: async () => ({ default: (await pagingControllers()).NotesController }),
      ChangesEndpoints: async () => ({ default: (await pagingControllers()).ChangesController }),
      EventsEndpoints: async () => ({ default: (await pagingControllers()).EventsController }),
      CappedEndpoints: async () => ({ default: (await pagingControllers()).CappedController }),
    },
    hooks: tasksPagingHooks(),
  });
}

function registerTasksRoutes(router: Router): void {
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
}

function sendControlReply(response: HttpContext["response"], reply: ControlReply): void {
  if (reply.body === undefined) response.status(reply.status).send("");
  else response.status(reply.status).json(reply.body);
}
