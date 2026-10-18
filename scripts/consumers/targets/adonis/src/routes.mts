// The consumer's start/routes: both apis' routes with the shared hooks, each controller imported lazily.
import type { Router } from "@adonisjs/core/http";
import * as TasksAdonis from "../generated/server/tasks/index.js";
import * as TasksServiceAdonis from "../generated/server/tasksService/index.js";
import {
  allowingDeciderHook,
  createIdempotencyStore,
  scopeResolverHook,
  serviceAuthenticateHook,
  stripeAuthenticateHook,
  throttlingDeciderHook,
  userAuthenticateHook,
} from "./hooks.mjs";

const controllers = () => import("./controllers.mjs");

export function registerContractRoutes(router: Router): void {
  TasksAdonis.registerRoutes(router, {
    controllers: {
      AppEndpoints: async () => ({ default: (await controllers()).AppController }),
      ChannelsEndpoints: async () => ({ default: (await controllers()).ChannelsController }),
      TasksEndpoints: async () => ({ default: (await controllers()).TasksController }),
      DraftsEndpoints: async () => ({ default: (await controllers()).DraftsController }),
      PreferencesEndpoints: async () => ({ default: (await controllers()).PreferencesController }),
      HooksEndpoints: async () => ({ default: (await controllers()).HooksController }),
    },
    hooks: {
      authenticate: { user: userAuthenticateHook, stripe: stripeAuthenticateHook },
      deciders: [{ names: "all", decider: throttlingDeciderHook }],
      scopeResolvers: { channel: scopeResolverHook },
      idempotencyStore: createIdempotencyStore(),
    },
  });

  TasksServiceAdonis.registerRoutes(router, {
    controllers: {
      InternalEndpoints: async () => ({ default: (await controllers()).InternalController }),
    },
    hooks: {
      authenticate: { service: serviceAuthenticateHook },
      deciders: [{ names: "all", decider: allowingDeciderHook }],
      scopeResolvers: {},
    },
  });
}
