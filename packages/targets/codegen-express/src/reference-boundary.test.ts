import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateReferenceProject,
  projectDirectory,
  REFERENCE_COMPILER_OPTIONS,
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

// Generating the reference project outruns vitest's default 10 s hook limit on a loaded machine.
const GENERATE_TIMEOUT_MILLISECONDS = 60_000;
// Type-checking both apis takes tens of seconds on a busy machine.
const TYPE_CHECK_TIMEOUT_MILLISECONDS = 120_000;

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

  test("the route table lists a static segment before a param at the same place", () => {
    const routes = readFileSync(join(PROJECT, "generated/server/tasks/routes.ts"), "utf8");
    const firstParamTask = routes.indexOf('"/v1/channels/{channelId}/tasks/{taskId}');

    expect(routes.indexOf('"/v1/channels/{channelId}/tasks/search"')).toBeLessThan(firstParamTask);
    expect(routes.indexOf('"/v1/channels/{channelId}/tasks/batch"')).toBeLessThan(firstParamTask);
  });
});
