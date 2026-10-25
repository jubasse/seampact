// Type checks of the generated Signal Store features, run by the consumer's `tsc`: a slice's error knows only the
// declared codes, and only a write whose operation takes an idempotency key takes `idempotencyKey`, as a string.

import {
  isContractError,
  type SliceOf,
  type TasksOperations,
} from "../../generated/queries/tasks/index.js";
import type { TaskBoardStore } from "../../src/front/app.mjs";

type Store = InstanceType<typeof TaskBoardStore>;

const LIST_REQUEST = { path: { channelId: "10000000-0000-4000-8000-000000000001" } };
const CREATE_REQUEST = { ...LIST_REQUEST, body: { title: "Typed" } };

export function isUndeclaredCode(slice: SliceOf<TasksOperations["createTask"]>): boolean {
  const { error } = slice;

  if (error === undefined || !isContractError(error) || error.failure.unexpected) return false;

  // @ts-expect-error: 'tasks.undeclared' is not a declared error code of createTask.
  return error.failure.code === "tasks.undeclared";
}

export function createWithKey(store: Store) {
  return store.sendCreateTask(CREATE_REQUEST, { idempotencyKey: "key-1" });
}

export function createWithNumericKey(store: Store) {
  // @ts-expect-error: the idempotency key is a string.
  return store.sendCreateTask(CREATE_REQUEST, { idempotencyKey: 1 });
}

export function listWithKey(store: Store) {
  // @ts-expect-error: a read takes no idempotency key.
  return store.sendListTasks(LIST_REQUEST, { idempotencyKey: "key-1" });
}
