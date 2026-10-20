import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GENERATE_TIMEOUT_MILLISECONDS,
  generateReferenceProject,
  hooksRequirementErrors,
  projectDirectory,
  publicTasksApi,
  REFERENCE_COMPILER_OPTIONS,
  TYPE_CHECK_TIMEOUT_MILLISECONDS,
  typeErrorsOf,
} from "@seampact/codegen-core/node-server/test-support";
import { beforeAll, describe, expect, test } from "vitest";
import { target as expressTarget } from "./index.js";

const PROJECT = projectDirectory(import.meta.url, "reference-boundary");
const INDEX_CHECK = "index-exports.check.ts";
// The fixed exports of ADR 0018 "Placement", each read through the api's index.
const FIXED_EXPORTS = [
  "router",
  "preRoutingErrorHandler",
  "renderPreRoutingError",
  "renderContractError",
  "isContractRoute",
  "keepRawBody",
  "LARGEST_BODY_LIMIT",
  "MAX_CHECKED_ERROR_BODY_BYTES",
  "MAX_RENDERED_ISSUES",
];

let files: string[] = [];

beforeAll(async () => {
  files = await generateReferenceProject(PROJECT, expressTarget, { bodyValidation: true });
  writeFileSync(
    join(PROJECT, INDEX_CHECK),
    [
      'import * as Tasks from "./generated/server/tasks/index.js";',
      'import type * as TasksTypes from "./generated/server/tasks/index.js";',
      "",
      `export const exported = [${FIXED_EXPORTS.map((name) => `Tasks.${name}`).join(", ")}];`,
      "export type Exported = [TasksTypes.TasksEndpoints, TasksTypes.SeampactHooks];",
      "",
    ].join("\n"),
  );
}, GENERATE_TIMEOUT_MILLISECONDS);

describe("the generated reference router compiles", () => {
  test(
    "both apis' types, validators and Express router type-check together",
    () => {
      expect(
        typeErrorsOf(PROJECT, [...files, join(PROJECT, INDEX_CHECK)], REFERENCE_COMPILER_OPTIONS),
      ).toEqual([]);
    },
    TYPE_CHECK_TIMEOUT_MILLISECONDS,
  );

  test("the generated comments name the handlers key and carry no NestJS wording", () => {
    const module = readFileSync(join(PROJECT, "generated/server/tasks/express.ts"), "utf8");
    const hooks = readFileSync(join(PROJECT, "generated/server/tasks/hooks.ts"), "utf8");

    expect(module).toContain("keyed by its name");
    expect(hooks).not.toContain("SeampactModule");
  });

  test("the route table lists a static segment before a param at the same place", () => {
    const routes = readFileSync(join(PROJECT, "generated/server/tasks/routes.ts"), "utf8");
    const firstParamTask = routes.indexOf('"/v1/channels/{channelId}/tasks/{taskId}');

    expect(routes.indexOf('"/v1/channels/{channelId}/tasks/search"')).toBeLessThan(firstParamTask);
    expect(routes.indexOf('"/v1/channels/{channelId}/tasks/batch"')).toBeLessThan(firstParamTask);
  });
});

describe("an api with only public operations asks for no hooks", () => {
  test(
    "it registers without hooks, and an api that needs hooks still requires them",
    async () => {
      const project = projectDirectory(import.meta.url, "public-api");
      const files = await generateReferenceProject(project, expressTarget, {}, publicTasksApi);
      const errors = hooksRequirementErrors(project, files, {
        publicTasks: [
          'declare const handlers: Parameters<typeof Tasks.router>[0]["handlers"];',
          "export const router = Tasks.router({ handlers });",
        ].join("\n"),
        guardedService: [
          'declare const handlers: Parameters<typeof Service.router>[0]["handlers"];',
          "export const router = Service.router({ handlers });",
        ].join("\n"),
      });

      expect(errors.publicTasks).toEqual([]);
      expect(errors.guardedService).toHaveLength(1);
      expect(errors.guardedService[0]).toContain("hooks");
    },
    GENERATE_TIMEOUT_MILLISECONDS + TYPE_CHECK_TIMEOUT_MILLISECONDS,
  );
});
