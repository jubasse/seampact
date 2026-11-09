// The consumer's NestJS module: each api's generated module with the shared hooks, the `inputRules` api's with its
// app input rules, the controllers and the http suite's control routes.
import { Module } from "@nestjs/common";
import * as InputRulesNest from "../generated/server/inputRules/index.js";
import * as TasksNest from "../generated/server/tasks/index.js";
import * as TasksDevicesNest from "../generated/server/tasksDevices/index.js";
import * as TasksPagingNest from "../generated/server/tasksPaging/index.js";
import * as TasksResponsesNest from "../generated/server/tasksResponses/index.js";
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
  inputRulesHooks,
  tasksDevicesHooks,
  tasksHooks,
  tasksServiceHooks,
  tasksServiceWritesHooks,
} from "./hooks.mjs";
import { inputRules } from "./input-rules.mjs";
import { InputRulesController } from "./input-rules-controller.mjs";
import {
  CappedController,
  ChangesController,
  EventsController,
  PagingNotesController,
} from "./paging-controllers.mjs";
import { tasksPagingHooks } from "./paging-handlers.mjs";
import {
  ResponsesController,
  ResponsesMemosController,
  ResponsesNotesController,
} from "./responses-controllers.mjs";
import { tasksResponsesHooks } from "./responses-handlers.mjs";
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
    TasksResponsesNest.SeampactModule.forRoot(tasksResponsesHooks()),
    TasksPagingNest.SeampactModule.forRoot(tasksPagingHooks()),
    InputRulesNest.SeampactModule.forRoot(inputRulesHooks(), { inputRules }),
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
    ResponsesController,
    ResponsesNotesController,
    ResponsesMemosController,
    PagingNotesController,
    ChangesController,
    CappedController,
    EventsController,
    InputRulesController,
    SuiteControlController,
    // The framework-route boot variants serve a route outside the contract.
    ...(servesUnlistedRoute() ? [UnlistedRouteController] : []),
    ...(servesPatternedRoute() ? [PatternedRouteController] : []),
  ],
})
export class ConsumerModule {}
