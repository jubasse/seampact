// Type checks of the generated RTK Query api, run by the consumer's `tsc`: an undeclared error code and a missing
// required timeout do not compile.

import { createClient } from "../../generated/client/tasksService/index.js";
import type { TasksFailure } from "../../generated/queries/tasks/index.js";
import { createTasksServiceApi } from "../../generated/queries/tasksService/index.js";

export function isUndeclaredCode(error: TasksFailure): boolean {
  if (error.kind !== "contract" || error.operation !== "createTask") return false;

  if (error.failure.unexpected) return false;

  // @ts-expect-error: 'tasks.undeclared' is not a declared error code of createTask.
  return error.failure.code === "tasks.undeclared";
}

export function getTaskWithoutTimeout() {
  const api = createTasksServiceApi(createClient({ baseUrl: "http://localhost" }));

  // @ts-expect-error: getTask sets a deadline header and has no budget, so the call options are required.
  return api.endpoints.getTask.initiate({
    request: { path: { taskId: "20000000-0000-4000-8000-0000000000ff" } },
  });
}
