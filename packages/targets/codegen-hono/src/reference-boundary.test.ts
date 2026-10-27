import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GENERATE_TIMEOUT_MILLISECONDS,
  generateReferenceProject,
  hooksRequirementErrors,
  projectDirectory,
  publicTasksApi,
  REFERENCE_COMPILER_OPTIONS,
  readGoldenIr,
  referenceLinks,
  referenceServerOutput,
  TYPE_CHECK_TIMEOUT_MILLISECONDS,
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
}, GENERATE_TIMEOUT_MILLISECONDS);

describe("the generated reference registration compiles", () => {
  test(
    "both apis' types, validators and Hono registration type-check together",
    () => {
      expect(
        typeErrorsOf(PROJECT, [...files, join(PROJECT, INDEX_CHECK)], REFERENCE_COMPILER_OPTIONS),
      ).toEqual([]);
    },
    TYPE_CHECK_TIMEOUT_MILLISECONDS,
  );
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
      outputDirectory: referenceServerOutput(PROJECT, "tasks"),
      artefacts: new Set(["boundary", "index"]),
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
      outputDirectory: referenceServerOutput(PROJECT, "tasks"),
      artefacts: new Set(["boundary", "index"]),
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

  // The boundary matches the raw path, so a static segment a client percent-encodes would never be served.
  test.each([
    ["my tasks", "my tasks"],
    ["tâches", "tâches"],
    ["a^b", "a^b"],
    ["a\\b", "a\\b"],
    ["a{b", "a{b"],
    ["a}b", "a}b"],
    ["a|b", "a|b"],
    ["a[b", "a[b"],
    ["a]b", "a]b"],
    ["a\u0007b", "a\\u0007b"],
  ])("a static segment a client sends percent-encoded, %j", async (segment, shownSegment) => {
    const ir = readGoldenIr("tasks");
    const archiveIndex = ir.operations.findIndex((operation) => operation.id === "archiveTask");
    const encodedSegmentIr = {
      ...ir,
      operations: ir.operations.map((operation, index) =>
        index === archiveIndex
          ? { ...operation, path: operation.path.replace(/archive$/, segment) }
          : operation,
      ),
    };

    const outcome = await honoTarget.generate({
      ir: encodedSegmentIr,
      options: { bodyValidation: true },
      links: await referenceLinks(PROJECT, "tasks"),
      outputDirectory: referenceServerOutput(PROJECT, "tasks"),
      artefacts: new Set(["boundary", "index"]),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: [
        {
          code: "path.segment.encoded.unsupported",
          message: expect.stringContaining(
            `The static path segment '${shownSegment}', which a client sends percent-encoded,`,
          ),
          fix: "Use plain ASCII letters, digits and '-' in that path part.",
          member: `/operations/${archiveIndex}/path`,
          operation: "archiveTask",
        },
      ],
    });
  });
});

describe("an api with only public operations asks for no hooks", () => {
  test(
    "it registers without hooks, and an api that needs hooks still requires them",
    async () => {
      const project = projectDirectory(import.meta.url, "public-api");
      const files = await generateReferenceProject(project, honoTarget, {}, publicTasksApi);
      const errors = hooksRequirementErrors(project, files, {
        publicTasks: [
          'import type { Hono } from "hono";',
          "declare const app: Hono;",
          'declare const handlers: Parameters<typeof Tasks.registerRoutes>[1]["handlers"];',
          "Tasks.registerRoutes(app, { handlers });",
        ].join("\n"),
        guardedService: [
          'import type { Hono } from "hono";',
          "declare const app: Hono;",
          'declare const handlers: Parameters<typeof Service.registerRoutes>[1]["handlers"];',
          "Service.registerRoutes(app, { handlers });",
        ].join("\n"),
      });

      expect(errors.publicTasks).toEqual([]);
      expect(errors.guardedService).toHaveLength(1);
      expect(errors.guardedService[0]).toContain("hooks");
    },
    GENERATE_TIMEOUT_MILLISECONDS + TYPE_CHECK_TIMEOUT_MILLISECONDS,
  );
});
