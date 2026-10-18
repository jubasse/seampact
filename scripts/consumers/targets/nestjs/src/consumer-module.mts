// The consumer's NestJS module: both apis' generated modules with the shared hooks, and the controllers.
import { Module } from "@nestjs/common";
import * as TasksNest from "../generated/server/tasks/index.js";
import * as TasksServiceNest from "../generated/server/tasksService/index.js";
import {
  AppController,
  ChannelsController,
  DraftsController,
  HooksController,
  InternalController,
  PreferencesController,
  TasksController,
} from "./controllers.mjs";
import {
  allowingDeciderHook,
  createIdempotencyStore,
  scopeResolverHook,
  serviceAuthenticateHook,
  stripeAuthenticateHook,
  throttlingDeciderHook,
  userAuthenticateHook,
} from "./hooks.mjs";

const tasksHooks: TasksNest.SeampactHooks = {
  authenticate: { user: userAuthenticateHook, stripe: stripeAuthenticateHook },
  deciders: [{ names: "all", decider: throttlingDeciderHook }],
  scopeResolvers: { channel: scopeResolverHook },
  idempotencyStore: createIdempotencyStore(),
};

const tasksServiceHooks: TasksServiceNest.SeampactHooks = {
  authenticate: { service: serviceAuthenticateHook },
  deciders: [{ names: "all", decider: allowingDeciderHook }],
  scopeResolvers: {},
};

@Module({
  imports: [
    TasksNest.SeampactModule.forRoot(tasksHooks),
    TasksServiceNest.SeampactModule.forRoot(tasksServiceHooks),
  ],
  controllers: [
    AppController,
    ChannelsController,
    TasksController,
    DraftsController,
    PreferencesController,
    HooksController,
    InternalController,
  ],
})
export class ConsumerModule {}
