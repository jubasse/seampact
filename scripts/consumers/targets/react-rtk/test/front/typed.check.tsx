// Type checks of the generated RTK Query api, run by the consumer's `tsc`: an undeclared error code and a missing
// required timeout do not compile; the same request with its timeout does.

import { createClient } from "../../generated/client/tasksService/index.js";
import type { TasksFailure } from "../../generated/queries/tasks/index.js";
import { createTasksServiceApi } from "../../generated/queries/tasksService/index.js";

export function isUndeclaredCode(error: TasksFailure): boolean {
  if (error.kind !== "contract" || error.operation !== "createTask") return false;

  if (error.failure.unexpected) return false;

  // @ts-expect-error: 'tasks.undeclared' is not a declared error code of createTask.
  return error.failure.code === "tasks.undeclared";
}

const GET_TASK_REQUEST = {
  path: {
    channelId: "10000000-0000-4000-8000-000000000001",
    taskId: "20000000-0000-4000-8000-0000000000ff",
  },
  headers: { authorization: "Bearer service-token" },
};

export function getTaskWithoutTimeout() {
  const api = createTasksServiceApi(createClient({ baseUrl: "http://localhost" }));

  // @ts-expect-error: getTask sets a deadline header and has no budget, so the call options are required.
  return api.endpoints.getTask.initiate({ request: GET_TASK_REQUEST });
}

export function getTaskWithTimeout() {
  const api = createTasksServiceApi(createClient({ baseUrl: "http://localhost" }));

  return api.endpoints.getTask.initiate({ request: GET_TASK_REQUEST, call: { timeoutMs: 1000 } });
}
