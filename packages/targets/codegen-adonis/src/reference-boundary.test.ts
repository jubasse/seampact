import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  TYPE_CHECK_TIMEOUT_MILLISECONDS,
  typeErrorsOf,
} from "@seampact/codegen-core/node-server/test-support";
import { type ContractIR, isKnownVariant, type Property } from "@seampact/spec/ir";
import { beforeAll, describe, expect, test } from "vitest";
import { type AdonisMajor, generateAdonisProject } from "./adonis-major.test-support.js";
import { target as adonisTarget } from "./index.js";

// Generating and type-checking both apis outruns vitest's default 5 s test limit on a loaded machine.
const COMPILE_TIMEOUT_MILLISECONDS = 60_000;
const MAJORS: readonly AdonisMajor[] = [7, 6];
const INDEX_PROJECT = projectDirectory(import.meta.url, "reference-index");
// A pattern whose plan message holds VineJS's placeholder syntax, one of them behind a backslash.
const BRACES_PATTERN = "^[{{field}}]\\{{2}$";

let indexFiles: string[] = [];

beforeAll(async () => {
  indexFiles = await generateAdonisProject(INDEX_PROJECT, 7, {});
}, COMPILE_TIMEOUT_MILLISECONDS);

describe("the generated reference boundary compiles", () => {
  test.each(MAJORS)(
    "both apis' types, validators and AdonisJS %i boundary type-check together",
    async (major) => {
      const project = projectDirectory(import.meta.url, `reference-boundary-${major}`);
      const files = await generateAdonisProject(project, major, { bodyValidation: true });

      expect(typeErrorsOf(project, files, REFERENCE_COMPILER_OPTIONS)).toEqual([]);
    },
    COMPILE_TIMEOUT_MILLISECONDS,
  );

  test("every public export of the boundary is reachable through the api's index", async () => {
    const index = await import(join(INDEX_PROJECT, "generated/server/tasks/index.ts"));
    const adonis = await import(join(INDEX_PROJECT, "generated/server/tasks/adonis.ts"));

    expect(Object.keys(index).sort()).toEqual(Object.keys(adonis).sort());
    expect(readFileSync(join(INDEX_PROJECT, "generated/server/tasks/index.ts"), "utf8")).toContain(
      "./handlers.js",
    );
  });

  test("an unknown option is refused by name", () => {
    expect(adonisTarget.parseOptions({ responses: "loose", extra: true })).toMatchObject({
      status: "refused",
      refusals: [{ code: "options.unknown" }, { code: "options.responses.invalid" }],
    });
  });

  test("both golden apis generate without a refusal", async () => {
    for (const api of ["tasks", "tasksService"]) {
      const outcome = await adonisTarget.generate({
        ir: readGoldenIr(api),
        options: {},
        links: await referenceLinks(INDEX_PROJECT, api),
        artefacts: new Set(["boundary"]),
      });

      expect(outcome.status).toBe("generated");
    }
  });
});

describe("with no validators link the target writes its own VineJS validators", () => {
  async function typesLinkOnly(): Promise<LinkSet> {
    const { types } = await referenceLinks(INDEX_PROJECT, "tasks");

    return { ...(types === undefined ? {} : { types }) };
  }

  async function writeOwnValidators(directory: string, ir: ContractIR): Promise<string[]> {
    const outcome = await adonisTarget.generate({
      ir,
      options: { bodyValidation: true },
      links: await typesLinkOnly(),
      artefacts: new Set(["boundary", "validators"]),
    });

    if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

    return outcome.files.map((file) => {
      const path = join(INDEX_PROJECT, directory, file.path);

      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.contents);

      return path;
    });
  }

  test("generates its own validators when no validators link is given", async () => {
    const outcome = await adonisTarget.generate({
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
        "validators/vine-support.ts",
        "validators/wire-checks.ts",
        "routes.ts",
      ]),
    );
    expect(routes).toContain('from "./validators/operations/input.js"');
  });

  test("a rule broken on the VineJS validators reads with the message of the validator plan", async () => {
    const written = await writeOwnValidators("generated/own-messages/tasks", readGoldenIr("tasks"));
    const schemasPath = written.find((path) => path.endsWith("schemas/input.ts"));

    if (schemasPath === undefined) throw new Error("no validators/schemas/input.ts written");

    const { CreateTaskSchema } = await import(schemasPath);
    const result = await CreateTaskSchema["~standard"].validate({ title: "x".repeat(201) });

    expect(result.issues).toEqual([
      expect.objectContaining({ message: "Expected at most 200 characters." }),
    ]);
  });

  test(
    "the generated VineJS validators type-check",
    async () => {
      const written = await writeOwnValidators("generated/own/tasks", readGoldenIr("tasks"));
      const types = indexFiles.filter((file) => file.includes("/types/"));

      expect(
        typeErrorsOf(INDEX_PROJECT, [...written, ...types], REFERENCE_COMPILER_OPTIONS),
      ).toEqual([]);
    },
    COMPILE_TIMEOUT_MILLISECONDS,
  );

  // The golden IR's CreateTask members: `title`, a required string, then `effort`, an optional integer.
  function createTaskProperties(ir: ContractIR): Property[] {
    const schema = ir.schemas.CreateTask;
    const properties =
      schema !== undefined && isKnownVariant("Schema", schema) && schema.kind === "object"
        ? schema.properties
        : [];

    if (properties.length < 2) throw new Error("the golden IR has no CreateTask properties");

    return properties;
  }

  async function createTaskSchemaOf(directory: string, ir: ContractIR) {
    const written = await writeOwnValidators(directory, ir);
    const schemasPath = written.find((path) => path.endsWith("schemas/input.ts"));

    if (schemasPath === undefined) throw new Error("no validators/schemas/input.ts written");

    const { CreateTaskSchema } = await import(schemasPath);

    return CreateTaskSchema;
  }

  test.each([
    ["a dot", "ti.tle"],
    ["a bracket", "ti[tle"],
    ["a single quote", "ti'tle"],
    ["a double quote", 'ti"tle'],
    ["a backslash", "ti\\tle"],
    ["a line feed", "ti\ntle"],
    ["a carriage return", "ti\rtle"],
    ["a line separator", "ti\u2028tle"],
    ["another control character", "ti\u0001tle"],
    ["text that would run as code", "x'+(seampactProbe=1)+'"],
  ])("refuses a wire name holding %s, which VineJS cannot hold", async (_kind, name) => {
    const ir = readGoldenIr("tasks");
    const [title] = createTaskProperties(ir);

    if (title !== undefined) title.name = name;

    const outcome = await adonisTarget.generate({
      ir,
      options: { bodyValidation: true },
      links: await typesLinkOnly(),
      artefacts: new Set(["boundary", "validators"]),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: [{ code: "wire.name.vinePath.unsupported" }],
    });
  });

  test("a member named after an Object.prototype member is read from the payload only", async () => {
    const ir = readGoldenIr("tasks");
    const [title, effort] = createTaskProperties(ir);

    if (title !== undefined) title.name = "toString";

    if (effort !== undefined) effort.name = "valueOf";

    const CreateTaskSchema = await createTaskSchemaOf("generated/own-prototype/tasks", ir);

    expect(await CreateTaskSchema["~standard"].validate({ toString: "x" })).toEqual({
      value: { toString: "x" },
    });

    const missing = await CreateTaskSchema["~standard"].validate({});

    expect(missing.issues).toEqual([
      expect.objectContaining({ path: ["toString"], params: { rule: "required" } }),
    ]);
    expect(missing.issues[0].message).not.toContain("native code");
  });

  test("a plan message holding braces and a backslash reads as written", async () => {
    const ir = readGoldenIr("tasks");
    const [title] = createTaskProperties(ir);

    if (
      title === undefined ||
      !isKnownVariant("TypeUse", title.type) ||
      title.type.kind !== "scalar"
    ) {
      throw new Error("the golden IR's CreateTask title is not a scalar");
    }

    title.type.refinements = { pattern: { source: BRACES_PATTERN, normalized: BRACES_PATTERN } };

    const CreateTaskSchema = await createTaskSchemaOf("generated/own-braces/tasks", ir);
    const result = await CreateTaskSchema["~standard"].validate({ title: "x" });

    expect(result.issues).toEqual([
      expect.objectContaining({ message: `Expected a value matching ${BRACES_PATTERN}.` }),
    ]);
  });
});

describe("an api with only public operations asks for no hooks", () => {
  test(
    "it registers without hooks, and an api that needs hooks still requires them",
    async () => {
      const project = projectDirectory(import.meta.url, "public-api");
      const files = await generateAdonisProject(project, 7, {}, publicTasksApi);
      const errors = hooksRequirementErrors(project, files, {
        publicTasks: [
          'import type { Router } from "@adonisjs/core/http";',
          "declare const router: Router;",
          'declare const controllers: Parameters<typeof Tasks.registerRoutes>[1]["controllers"];',
          "Tasks.registerRoutes(router, { controllers });",
        ].join("\n"),
        guardedService: [
          'import type { Router } from "@adonisjs/core/http";',
          "declare const router: Router;",
          'declare const controllers: Parameters<typeof Service.registerRoutes>[1]["controllers"];',
          "Service.registerRoutes(router, { controllers });",
        ].join("\n"),
      });

      expect(errors.publicTasks).toEqual([]);
      expect(errors.guardedService).toHaveLength(1);
      expect(errors.guardedService[0]).toContain("hooks");
    },
    GENERATE_TIMEOUT_MILLISECONDS + TYPE_CHECK_TIMEOUT_MILLISECONDS,
  );
});
