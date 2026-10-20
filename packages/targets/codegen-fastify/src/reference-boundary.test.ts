import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LinkSet } from "@seampact/codegen-core";
import {
  GENERATE_TIMEOUT_MILLISECONDS,
  generateReferenceProject,
  projectDirectory,
  REFERENCE_COMPILER_OPTIONS,
  readGoldenIr,
  referenceLinks,
  TYPE_CHECK_TIMEOUT_MILLISECONDS,
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
}, GENERATE_TIMEOUT_MILLISECONDS);

describe("the generated reference plugin compiles", () => {
  test(
    "both apis' types, validators and Fastify plugin type-check together",
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

describe("with no validators link the target writes its own Ajv validators", () => {
  async function typesLinkOnly(): Promise<LinkSet> {
    const { types } = await referenceLinks(PROJECT, "tasks");

    return { ...(types === undefined ? {} : { types }) };
  }

  test("generates its own validators when no validators link is given", async () => {
    const outcome = await fastifyTarget.generate({
      ir: readGoldenIr("tasks"),
      options: { bodyValidation: true },
      links: await typesLinkOnly(),
      artefacts: new Set(["boundary", "validators"]),
    });

    if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

    const paths = outcome.files.map((file) => file.path);
    const routes = outcome.files.find((file) => file.path === "routes.ts")?.contents ?? "";

    expect(paths).toEqual(
      expect.arrayContaining([
        "validators/schemas/input.ts",
        "validators/schemas/output.ts",
        "validators/operations/input.ts",
        "validators/ajv-support.ts",
        "validators/wire-checks.ts",
        "routes.ts",
      ]),
    );
    expect(routes).toContain('from "./validators/operations/input.js"');
  });

  test("writes no validators file when a validators link is given", async () => {
    const outcome = await fastifyTarget.generate({
      ir: readGoldenIr("tasks"),
      options: { bodyValidation: true },
      links: await referenceLinks(PROJECT, "tasks"),
      artefacts: new Set(["boundary", "validators"]),
    });

    if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

    expect(outcome.files.filter((file) => file.path.startsWith("validators/"))).toEqual([]);
    expect(outcome.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "validators.artefact.ignored" })]),
    );
  });

  test("warns that the validators artefact is ignored when it is the only one and a link is given", async () => {
    const outcome = await fastifyTarget.generate({
      ir: readGoldenIr("tasks"),
      options: { bodyValidation: true },
      links: await referenceLinks(PROJECT, "tasks"),
      artefacts: new Set(["validators"]),
    });

    expect(outcome).toMatchObject({
      status: "generated",
      files: [],
      warnings: [{ code: "validators.artefact.ignored" }],
    });
  });

  test("refuses the validators artefact turned off while the boundary has no link", async () => {
    const outcome = await fastifyTarget.generate({
      ir: readGoldenIr("tasks"),
      options: { bodyValidation: true },
      links: await typesLinkOnly(),
      artefacts: new Set(["boundary"]),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: [{ code: "artefact.validators.needed" }],
    });
  });

  test("a rule broken on the Ajv validators reads with the message of the validator plan", async () => {
    const outcome = await fastifyTarget.generate({
      ir: readGoldenIr("tasks"),
      options: { bodyValidation: true },
      links: await typesLinkOnly(),
      artefacts: new Set(["boundary", "validators"]),
    });

    if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

    const written = outcome.files
      .filter((file) => file.path.startsWith("validators/"))
      .map((file) => {
        const path = join(PROJECT, "generated/own-messages/tasks", file.path);

        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.contents);

        return path;
      });
    const schemasPath = written.find((path) => path.endsWith("schemas/input.ts"));

    if (schemasPath === undefined) throw new Error("no validators/schemas/input.ts written");

    const { CreateTaskSchema } = await import(schemasPath);
    const result = await CreateTaskSchema["~standard"].validate({ title: "x".repeat(201) });

    expect(result.issues).toEqual([
      expect.objectContaining({ message: "Expected at most 200 characters." }),
    ]);
  });

  test("the generated Ajv validators type-check with the plugin", async () => {
    const outcome = await fastifyTarget.generate({
      ir: readGoldenIr("tasks"),
      options: { bodyValidation: true },
      links: await typesLinkOnly(),
      artefacts: new Set(["boundary", "validators"]),
    });

    if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

    const written = outcome.files.map((file) => {
      const path = join(PROJECT, "generated/own/tasks", file.path);

      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.contents);

      return path;
    });

    expect(
      typeErrorsOf(
        PROJECT,
        [...written, ...files.filter((file) => file.includes("/types/"))],
        REFERENCE_COMPILER_OPTIONS,
      ),
    ).toEqual([]);
  });
});
