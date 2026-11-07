import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GENERATE_TIMEOUT_MILLISECONDS,
  generateReferenceProject,
  projectDirectory,
  REFERENCE_COMPILER_OPTIONS,
  TYPE_CHECK_TIMEOUT_MILLISECONDS,
  typeErrorsOf,
} from "@seampact/codegen-core/node-server/test-support";
import { beforeAll, expect, test } from "vitest";
import { target as nestjsTarget } from "./index.js";

const PROJECT = projectDirectory(import.meta.url, "status-constants");

const DECLARED_RETURNS_FILE = "declared-returns.ts";
const UNDECLARED_STATUS_FILE = "undeclared-status.ts";

// A handler of `getTask` that returns its declared 404 and 200 through the api constants, without `as const`.
const DECLARED_RETURNS_HANDLER = `import type * as TasksNest from "./generated/server/tasks/index.js";
import * as Tasks from "./generated/types/tasks/index.js";

declare const task: Tasks.schemas.Task;

export class TasksController implements Pick<TasksNest.TasksEndpoints, "getTask"> {
  getTask(input: Tasks.GetTaskInput) {
    if (input.path.taskId === "") return { status: Tasks.Status.NotFound, code: Tasks.ErrorCode.ApiNotFound };

    return { status: Tasks.Status.Ok, body: task };
  }
}
`;

// The same handler answering 201, a status of the api that `getTask` does not declare.
const UNDECLARED_STATUS_HANDLER = `import type * as TasksNest from "./generated/server/tasks/index.js";
import * as Tasks from "./generated/types/tasks/index.js";

declare const task: Tasks.schemas.Task;

export class TasksController implements Pick<TasksNest.TasksEndpoints, "getTask"> {
  getTask(_input: Tasks.GetTaskInput) {
    return { status: Tasks.Status.Created, body: task };
  }
}
`;

let typeErrors: string[] = [];

beforeAll(async () => {
  const files = await generateReferenceProject(PROJECT, nestjsTarget, {});

  writeFileSync(join(PROJECT, DECLARED_RETURNS_FILE), DECLARED_RETURNS_HANDLER);
  writeFileSync(join(PROJECT, UNDECLARED_STATUS_FILE), UNDECLARED_STATUS_HANDLER);

  typeErrors = typeErrorsOf(
    PROJECT,
    [...files, join(PROJECT, DECLARED_RETURNS_FILE), join(PROJECT, UNDECLARED_STATUS_FILE)],
    REFERENCE_COMPILER_OPTIONS,
  );
}, GENERATE_TIMEOUT_MILLISECONDS + TYPE_CHECK_TIMEOUT_MILLISECONDS);

test("a handler returns the declared statuses and codes through the api constants without as const", () => {
  expect(typeErrors.filter((error) => error.includes(DECLARED_RETURNS_FILE))).toEqual([]);
});

test("a status of the api that the operation does not declare fails to type-check", () => {
  expect(typeErrors).toEqual([
    expect.stringContaining("Type '201' is not assignable to type '200'"),
  ]);
  expect(typeErrors[0]).toContain(UNDECLARED_STATUS_FILE);
});
