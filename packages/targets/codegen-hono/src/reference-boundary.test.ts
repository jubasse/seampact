import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateReferenceProject,
  projectDirectory,
  REFERENCE_COMPILER_OPTIONS,
  readGoldenIr,
  referenceLinks,
  typeErrorsOf,
} from "@seampact/codegen-core/node-server/test-support";
import { beforeAll, describe, expect, test } from "vitest";
import { target as honoTarget } from "./index.js";

const PROJECT = projectDirectory(import.meta.url, "reference-boundary");
const INDEX_CHECK = "index-exports.check.ts";
// The fixed exports of ADR 0020 "Placement", each read through the api's index.
const FIXED_EXPORTS = [
  "registerRoutes",
  "renderContractError",
  "renderPreRoutingError",
  "isContractRoute",
  "MAX_CHECKED_ERROR_BODY_BYTES",
  "MAX_RENDERED_ISSUES",
];

let files: string[] = [];

beforeAll(async () => {
  files = await generateReferenceProject(PROJECT, honoTarget, { bodyValidation: true });
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
});

describe("the generated reference registration compiles", () => {
  test("both apis' types, validators and Hono registration type-check together", () => {
    expect(
      typeErrorsOf(PROJECT, [...files, join(PROJECT, INDEX_CHECK)], REFERENCE_COMPILER_OPTIONS),
    ).toEqual([]);
  });
});

describe("a path the router cannot read as written is refused by name", () => {
  test("a segment that mixes a placeholder with literal text", async () => {
    const ir = readGoldenIr("tasks");
    const archiveIndex = ir.operations.findIndex((operation) => operation.id === "archiveTask");
    const mixedSegmentIr = {
      ...ir,
      operations: ir.operations.map((operation, index) =>
        index === archiveIndex
          ? { ...operation, path: "/v1/channels/{channelId}/tasks/{taskId}:archive" }
          : operation,
      ),
    };

    const outcome = await honoTarget.generate({
      ir: mixedSegmentIr,
      options: { bodyValidation: true },
      links: await referenceLinks(PROJECT, "tasks"),
      artefacts: new Set(["boundary"]),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: [
        {
          code: "path.segment.mixed.unsupported",
          member: `/operations/${archiveIndex}/path`,
          operation: "archiveTask",
        },
      ],
    });
  });

  test.each([
    ["starts with ':'", "/v1/channels/{channelId}/:batch"],
    ["holds '*'", "/v1/channels/{channelId}/tasks*"],
  ])("a static segment that %s", async (_case, path) => {
    const ir = readGoldenIr("tasks");
    const archiveIndex = ir.operations.findIndex((operation) => operation.id === "archiveTask");
    const literalSegmentIr = {
      ...ir,
      operations: ir.operations.map((operation, index) =>
        index === archiveIndex ? { ...operation, path } : operation,
      ),
    };

    const outcome = await honoTarget.generate({
      ir: literalSegmentIr,
      options: { bodyValidation: true },
      links: await referenceLinks(PROJECT, "tasks"),
      artefacts: new Set(["boundary"]),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: [
        {
          code: "path.segment.literal.unsupported",
          member: `/operations/${archiveIndex}/path`,
          operation: "archiveTask",
        },
      ],
    });
  });
});
