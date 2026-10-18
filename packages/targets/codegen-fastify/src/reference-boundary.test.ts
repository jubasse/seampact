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
import { target as fastifyTarget } from "./index.js";

const PROJECT = projectDirectory(import.meta.url, "reference-boundary");
const INDEX_CHECK = "index-exports.check.ts";
// The fixed exports of ADR 0017 "Placement", each read through the api's index.
const FIXED_EXPORTS = [
  "plugin",
  "renderContractError",
  "renderPreRoutingError",
  "isContractRoute",
  "MAX_CHECKED_ERROR_BODY_BYTES",
  "MAX_RENDERED_ISSUES",
];

let files: string[] = [];

beforeAll(async () => {
  files = await generateReferenceProject(PROJECT, fastifyTarget, { bodyValidation: true });
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

describe("the generated reference plugin compiles", () => {
  test("both apis' types, validators and Fastify plugin type-check together", () => {
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

    const outcome = await fastifyTarget.generate({
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
});
