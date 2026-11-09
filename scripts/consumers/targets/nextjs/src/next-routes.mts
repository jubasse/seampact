// The route handler of each api, built once from the sample app's handlers and hooks as the guide shows: each api's
// catch-all route files re-export it, so one api's route files share its hooks and its stores.
import { routeHandler as inputRulesRouteHandler } from "../generated/server/inputRules";
import { routeHandler as tasksRouteHandlerOf } from "../generated/server/tasks";
import { routeHandler as tasksDevicesRouteHandler } from "../generated/server/tasksDevices";
import { routeHandler as tasksPagingRouteHandler } from "../generated/server/tasksPaging";
import { routeHandler as tasksResponsesRouteHandler } from "../generated/server/tasksResponses";
import { routeHandler as tasksServiceRouteHandler } from "../generated/server/tasksService";
import { routeHandler as tasksServiceWritesRouteHandler } from "../generated/server/tasksServiceWrites";
import {
  tasksDevicesHandlers,
  tasksHandlers,
  tasksServiceHandlers,
  tasksServiceWritesHandlers,
} from "./handlers.mjs";
import {
  inputRulesHooks,
  tasksDevicesHooks,
  tasksHooks,
  tasksServiceHooks,
  tasksServiceWritesHooks,
} from "./hooks.mjs";
import { inputRules } from "./input-rules.mjs";
import { inputRulesHandlers } from "./input-rules-handlers.mjs";
import { tasksPagingHandlers, tasksPagingHooks } from "./paging-handlers.mjs";
import { tasksResponsesHandlers, tasksResponsesHooks } from "./responses-handlers.mjs";

// The last entry of X-Forwarded-For, the one the app's own proxy wrote.
function clientAddress(request: Request): string | undefined {
  return request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
}

export const tasksRouteHandler = tasksRouteHandlerOf({
  handlers: {
    AppEndpoints: tasksHandlers,
    ChannelsEndpoints: tasksHandlers,
    TasksEndpoints: tasksHandlers,
    DraftsEndpoints: tasksHandlers,
    PreferencesEndpoints: tasksHandlers,
    HooksEndpoints: tasksHandlers,
  },
  hooks: tasksHooks(),
  clientAddress,
});

export const tasksServiceHandler = tasksServiceRouteHandler({
  handlers: { InternalEndpoints: tasksServiceHandlers },
  hooks: tasksServiceHooks(),
  clientAddress,
});

export const tasksServiceWritesHandler = tasksServiceWritesRouteHandler({
  handlers: { InternalWritesEndpoints: tasksServiceWritesHandlers },
  hooks: tasksServiceWritesHooks(),
  clientAddress,
});

export const tasksDevicesHandler = tasksDevicesRouteHandler({
  handlers: { DevicesEndpoints: tasksDevicesHandlers },
  hooks: tasksDevicesHooks(),
  clientAddress,
});

export const tasksResponsesHandler = tasksResponsesRouteHandler({
  handlers: {
    ResponsesEndpoints: tasksResponsesHandlers,
    NotesEndpoints: tasksResponsesHandlers,
    MemosEndpoints: tasksResponsesHandlers,
  },
  hooks: tasksResponsesHooks(),
  clientAddress,
});

export const tasksPagingHandler = tasksPagingRouteHandler({
  handlers: {
    NotesEndpoints: tasksPagingHandlers,
    ChangesEndpoints: tasksPagingHandlers,
    CappedEndpoints: tasksPagingHandlers,
    EventsEndpoints: tasksPagingHandlers,
  },
  hooks: tasksPagingHooks(),
  clientAddress,
});

export const inputRulesHandler = inputRulesRouteHandler({
  handlers: { AppEndpoints: inputRulesHandlers },
  hooks: inputRulesHooks(),
  inputRules,
  clientAddress,
});
