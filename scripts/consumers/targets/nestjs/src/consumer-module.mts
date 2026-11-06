// The consumer's NestJS module: each api's generated module with the shared hooks, the controllers and the http
// suite's control routes.
import { Module } from "@nestjs/common";
import * as TasksNest from "../generated/server/tasks/index.js";
import * as TasksDevicesNest from "../generated/server/tasksDevices/index.js";
import * as TasksServiceNest from "../generated/server/tasksService/index.js";
import * as TasksServiceWritesNest from "../generated/server/tasksServiceWrites/index.js";
import { bootVariantIs, servesUnlistedRoute } from "./boot-variant.mjs";
import {
  AppController,
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
import { SuiteControlController, UnlistedRouteController } from "./suite-control-controller.mjs";

@Module({
  imports: [
    TasksNest.SeampactModule.forRoot(tasksHooks()),
    // Built by a factory, as an app whose hooks need its own providers registers them.
    TasksServiceNest.SeampactModule.forRootAsync({ useFactory: () => tasksServiceHooks() }),
    TasksServiceWritesNest.SeampactModule.forRoot(tasksServiceWritesHooks()),
    TasksDevicesNest.SeampactModule.forRoot(tasksDevicesHooks()),
  ],
  controllers: [
    // The `missing-handler` boot variant leaves out the controller of the `health` operation.
    ...(bootVariantIs("missing-handler") ? [] : [AppController]),
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
  ],
})
export class ConsumerModule {}
