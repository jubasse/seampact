// The controller of the `tasks` api's `health` operation, apart from the others: the boot variants that filter that
// operation out of the generated server load none of its decorators, so they never import this module.
import { Controller } from "@nestjs/common";
import * as TasksNest from "../generated/server/tasks/index.js";
import type * as Tasks from "../generated/types/tasks/index.js";
import { tasksHandlers } from "./handlers.mjs";

@Controller()
export class AppController implements TasksNest.AppEndpoints {
  @TasksNest.health()
  health(@TasksNest.health.input() _input: Tasks.HealthInput) {
    return tasksHandlers.health();
  }
}
