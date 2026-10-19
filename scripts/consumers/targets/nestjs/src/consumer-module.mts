// The consumer's NestJS module: both apis' generated modules with the shared hooks, the controllers and the http
// suite's control routes.
import { Module } from "@nestjs/common";
import * as TasksNest from "../generated/server/tasks/index.js";
import * as TasksServiceNest from "../generated/server/tasksService/index.js";
import { bootVariantIs, servesUnlistedRoute } from "./boot-variant.mjs";
import {
  AppController,
  ChannelsController,
  DraftsController,
  HooksController,
  InternalController,
  PreferencesController,
  TasksController,
} from "./controllers.mjs";
import { tasksHooks, tasksServiceHooks } from "./hooks.mjs";
import { SuiteControlController, UnlistedRouteController } from "./suite-control-controller.mjs";

@Module({
  imports: [
    TasksNest.SeampactModule.forRoot(tasksHooks()),
    TasksServiceNest.SeampactModule.forRoot(tasksServiceHooks()),
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
    SuiteControlController,
    // The framework-route boot variants serve a route outside the contract.
    ...(servesUnlistedRoute() ? [UnlistedRouteController] : []),
  ],
})
export class ConsumerModule {}
