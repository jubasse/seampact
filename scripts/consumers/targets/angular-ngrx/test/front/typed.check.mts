// Type checks of the generated NgRx actions, run by the consumer's `tsc`: a failure's error knows only the declared
// codes, and only a write action whose operation takes an idempotency key takes `call.idempotencyKey`, as a string.

import { isContractError, TasksActions } from "../../generated/queries/tasks/index.js";

const LIST_REQUEST = { path: { channelId: "10000000-0000-4000-8000-000000000001" } };
const CREATE_REQUEST = { ...LIST_REQUEST, body: { title: "Typed" } };

export function isUndeclaredCode(
  failure: ReturnType<typeof TasksActions.createTaskFailure>,
): boolean {
  const { error } = failure;

  if (!isContractError(error) || error.failure.unexpected) return false;

  // @ts-expect-error: 'tasks.undeclared' is not a declared error code of createTask.
  return error.failure.code === "tasks.undeclared";
}

export function createWithKey() {
  return TasksActions.createTask({ request: CREATE_REQUEST, call: { idempotencyKey: "key-1" } });
}

export function createWithNumericKey() {
  // @ts-expect-error: the idempotency key is a string.
  return TasksActions.createTask({ request: CREATE_REQUEST, call: { idempotencyKey: 1 } });
}

export function listWithKey() {
  // @ts-expect-error: a read takes no idempotency key.
  return TasksActions.listTasks({ request: LIST_REQUEST, call: { idempotencyKey: "key-1" } });
}
