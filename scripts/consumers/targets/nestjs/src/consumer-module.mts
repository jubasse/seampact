// The consumer's NestJS module: each api's generated module with the shared hooks, the controllers and the http
// suite's control routes.
import { Module } from "@nestjs/common";
import * as TasksNest from "../generated/server/tasks/index.js";
import * as TasksDevicesNest from "../generated/server/tasksDevices/index.js";
import * as TasksServiceNest from "../generated/server/tasksService/index.js";
import * as TasksServiceWritesNest from "../generated/server/tasksServiceWrites/index.js";
import {
  leavesOutHealthHandler,
  servesPatternedRoute,
  servesUnlistedRoute,
} from "./boot-variant.mjs";
import {
  ChannelsController,
  DevicesController,
  DraftsController,
  HooksController,
  InternalController,
  InternalWritesController,
  PreferencesController,
  TasksController,
} from "./controllers.mjs";
import {
  tasksDevicesHooks,
  tasksHooks,
  tasksServiceHooks,
  tasksServiceWritesHooks,
} from "./hooks.mjs";
import {
  PatternedRouteController,
  SuiteControlController,
  UnlistedRouteController,
} from "./suite-control-controller.mjs";

// A boot variant that misses the `health` operation's handler, or filters it out, leaves out its controller.
const healthControllers = leavesOutHealthHandler()
  ? []
  : [(await import("./app-controller.mjs")).AppController];

@Module({
  imports: [
    TasksNest.SeampactModule.forRoot(tasksHooks()),
    // Built by a factory, as an app whose hooks need its own providers registers them.
    TasksServiceNest.SeampactModule.forRootAsync({ useFactory: () => tasksServiceHooks() }),
    TasksServiceWritesNest.SeampactModule.forRoot(tasksServiceWritesHooks()),
    TasksDevicesNest.SeampactModule.forRoot(tasksDevicesHooks()),
  ],
  controllers: [
    ...healthControllers,
    ChannelsController,
    TasksController,
    DraftsController,
    PreferencesController,
    HooksController,
    InternalController,
    InternalWritesController,
    DevicesController,
    SuiteControlController,
    // The framework-route boot variants serve a route outside the contract.
    ...(servesUnlistedRoute() ? [UnlistedRouteController] : []),
    ...(servesPatternedRoute() ? [PatternedRouteController] : []),
  ],
})
export class ConsumerModule {}
