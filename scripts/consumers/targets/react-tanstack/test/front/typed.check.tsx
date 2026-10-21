// Type checks of the generated queries, run by the consumer's `tsc`: an undeclared error code and a missing
// required timeout do not compile.

import { createClient } from "../../generated/client/tasksService/index.js";
import { isContractError, type TasksOperations } from "../../generated/queries/tasks/index.js";
import { createTasksServiceQueries } from "../../generated/queries/tasksService/index.js";

export function isUndeclaredCode(error: TasksOperations["createTask"]["error"]): boolean {
  if (!isContractError(error) || error.failure.unexpected) return false;

  // @ts-expect-error: 'tasks.undeclared' is not a declared error code of createTask.
  return error.failure.code === "tasks.undeclared";
}

export function getTaskWithoutTimeout() {
  const queries = createTasksServiceQueries(createClient({ baseUrl: "http://localhost" }));

  // @ts-expect-error: getTask sets a deadline header and has no budget, so `call.timeoutMs` is required.
  return queries.getTaskOptions({ path: { taskId: "20000000-0000-4000-8000-0000000000ff" } });
}
