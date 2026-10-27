import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LinkSet } from "@seampact/codegen-core";
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
import { isKnownVariant } from "@seampact/spec/ir";
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
      outputDirectory: referenceServerOutput(PROJECT, "tasks"),
      artefacts: new Set(["boundary", "index", "validators"]),
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
      outputDirectory: referenceServerOutput(PROJECT, "tasks"),
      artefacts: new Set(["boundary", "index", "validators"]),
    });

    if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

    expect(outcome.files.filter((file) => file.path.startsWith("validators/"))).toEqual([]);
    expect(outcome.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "validators.artefact.ignored" })]),
    );
  });

  test("the compression option reaches the route table, and its default is 1024 bytes", async () => {
    const routesFor = async (options: Record<string, unknown>) => {
      const outcome = await fastifyTarget.generate({
        ir: readGoldenIr("tasks"),
        options,
        links: await referenceLinks(PROJECT, "tasks"),
        outputDirectory: referenceServerOutput(PROJECT, "tasks"),
        artefacts: new Set(["boundary", "index", "validators"]),
      });

      if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

      return outcome.files.find((file) => file.path === "routes.ts")?.contents ?? "";
    };

    expect(await routesFor({})).toMatch(/compression: \{\s*thresholdBytes: 1024\s*\}/);
    expect(await routesFor({ compression: "off" })).toContain('compression: "off"');
    expect(await routesFor({ compression: { thresholdBytes: 4096 } })).toMatch(
      /thresholdBytes: 4096/,
    );
  });

  test("writes the api index only when the index artefact is on", async () => {
    const generate = (artefacts: string[]) =>
      referenceLinks(PROJECT, "tasks").then((links) =>
        fastifyTarget.generate({
          ir: readGoldenIr("tasks"),
          options: { bodyValidation: true },
          links,
          outputDirectory: referenceServerOutput(PROJECT, "tasks"),
          artefacts: new Set(artefacts),
        }),
      );
    const withIndex = await generate(["boundary", "index", "validators"]);
    const withoutIndex = await generate(["boundary", "validators"]);

    if (withIndex.status !== "generated" || withoutIndex.status !== "generated")
      throw new Error("the reference api was refused");

    expect(withIndex.files.map((file) => file.path)).toContain("index.ts");
    expect(withoutIndex.files.map((file) => file.path)).not.toContain("index.ts");
    expect(withoutIndex.files.map((file) => file.path)).toContain("fastify.ts");
  });

  test("warns that the validators artefact is ignored when it is the only one and a link is given", async () => {
    const outcome = await fastifyTarget.generate({
      ir: readGoldenIr("tasks"),
      options: { bodyValidation: true },
      links: await referenceLinks(PROJECT, "tasks"),
      outputDirectory: referenceServerOutput(PROJECT, "tasks"),
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
      outputDirectory: referenceServerOutput(PROJECT, "tasks"),
      artefacts: new Set(["boundary", "index"]),
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
      outputDirectory: referenceServerOutput(PROJECT, "tasks"),
      artefacts: new Set(["boundary", "index", "validators"]),
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

  test("a member named after an Object.prototype member is read from the payload only", async () => {
    const ir = readGoldenIr("tasks");
    const schema = ir.schemas.CreateTask;
    const [title, effort] =
      schema !== undefined && isKnownVariant("Schema", schema) && schema.kind === "object"
        ? schema.properties
        : [];

    if (title === undefined || effort === undefined) {
      throw new Error("the golden IR has no CreateTask title and effort");
    }

    title.name = "toString";
    effort.name = "valueOf";

    const outcome = await fastifyTarget.generate({
      ir,
      options: { bodyValidation: true },
      links: await typesLinkOnly(),
      outputDirectory: referenceServerOutput(PROJECT, "tasks"),
      artefacts: new Set(["boundary", "index", "validators"]),
    });

    if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

    const schemasFile = outcome.files.find((file) => file.path === "validators/schemas/input.ts");

    if (schemasFile === undefined) throw new Error("no validators/schemas/input.ts generated");

    const schemasPath = join(PROJECT, "generated/own-prototype/tasks", schemasFile.path);

    for (const file of outcome.files.filter((file) => file.path.startsWith("validators/"))) {
      const path = join(PROJECT, "generated/own-prototype/tasks", file.path);

      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.contents);
    }

    const { CreateTaskSchema } = await import(schemasPath);

    expect(await CreateTaskSchema["~standard"].validate({ toString: "x" })).toEqual({
      value: { toString: "x" },
    });
    expect((await CreateTaskSchema["~standard"].validate({})).issues).toEqual([
      expect.objectContaining({ path: ["toString"], params: { rule: "required" } }),
    ]);
  });

  test("the generated Ajv validators type-check with the plugin", async () => {
    const outcome = await fastifyTarget.generate({
      ir: readGoldenIr("tasks"),
      options: { bodyValidation: true },
      links: await typesLinkOnly(),
      outputDirectory: referenceServerOutput(PROJECT, "tasks"),
      artefacts: new Set(["boundary", "index", "validators"]),
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

describe("an api with only public operations asks for no hooks", () => {
  test(
    "it registers without hooks, and an api that needs hooks still requires them",
    async () => {
      const project = projectDirectory(import.meta.url, "public-api");
      const files = await generateReferenceProject(project, fastifyTarget, {}, publicTasksApi);
      const errors = hooksRequirementErrors(project, files, {
        publicTasks: [
          'import type { FastifyInstance } from "fastify";',
          "declare const app: FastifyInstance;",
          'declare const handlers: Parameters<typeof Tasks.plugin>[1]["handlers"];',
          "export const registered = app.register(Tasks.plugin, { handlers });",
        ].join("\n"),
        guardedService: [
          'import type { FastifyInstance } from "fastify";',
          "declare const app: FastifyInstance;",
          'declare const handlers: Parameters<typeof Service.plugin>[1]["handlers"];',
          "export const registered = app.register(Service.plugin, { handlers });",
        ].join("\n"),
      });

      expect(errors.publicTasks).toEqual([]);
      expect(errors.guardedService).toHaveLength(1);
      expect(errors.guardedService[0]).toContain("hooks");
    },
    GENERATE_TIMEOUT_MILLISECONDS + TYPE_CHECK_TIMEOUT_MILLISECONDS,
  );
});
