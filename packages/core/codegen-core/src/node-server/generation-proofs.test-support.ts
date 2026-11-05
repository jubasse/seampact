import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContractIR } from "@seampact/spec/ir";
import { beforeAll, describe, expect, test } from "vitest";
import type { GeneratedFile, Target } from "../target.js";
import {
  GENERATE_TIMEOUT_MILLISECONDS,
  generateReferenceProject,
  projectDirectory,
  REFERENCE_COMPILER_OPTIONS,
  readGoldenIr,
  referenceLinks,
  referenceServerOutput,
  TYPE_CHECK_TIMEOUT_MILLISECONDS,
  typeErrorsOf,
} from "./reference-project.test-support.js";

// The generation proofs every Node server target shares: what its generated reference boundary says about errors,
// handler types, hooks, the IR it reads and the code it leaves to the developer. A target's test file calls
// `describeGenerationProofs` once; the test names are the ones the proof file cites.

export interface GenerationProofSubject {
  readonly target: Target;
  readonly serverOptions: Readonly<Record<string, unknown>>;
  /** The test file's URL, which places the generated project beside the target's tests. */
  readonly testFileUrl: string;
  /** The framework file the target writes beside the shared ones, such as `fastify.ts`. */
  readonly frameworkFile: string;
  /** The export the app registers the boundary with, such as `plugin`. */
  readonly registration: string;
}

const API = "tasks";
const MEMORY_STORE_SOURCE = fileURLToPath(
  new URL("../../../../runtime/idempotency-memory/src/index.js", import.meta.url),
);

const PROBE_IMPORTS = `import type * as Server from "./generated/server/tasks/index.js";
import * as Tasks from "./generated/types/tasks/index.js";

declare const task: Tasks.schemas.Task;
`;

// Each probe is a controller of `getTask`; the first returns what the operation declares.
const PROBES = {
  declared: `${PROBE_IMPORTS}
export class Declared implements Pick<Server.TasksEndpoints, "getTask"> {
  getTask(input: Tasks.GetTaskInput) {
    if (input.path.taskId === "") return { status: Tasks.Status.NotFound, code: Tasks.ErrorCode.ApiNotFound };

    return { status: Tasks.Status.Ok, body: task };
  }
}
`,
  undeclaredCode: `${PROBE_IMPORTS}
export class UndeclaredCode implements Pick<Server.TasksEndpoints, "getTask"> {
  getTask(_input: Tasks.GetTaskInput) {
    return { status: Tasks.Status.NotFound, code: "api.nope" };
  }
}
`,
  undeclaredStatus: `${PROBE_IMPORTS}
export class UndeclaredStatus implements Pick<Server.TasksEndpoints, "getTask"> {
  getTask(_input: Tasks.GetTaskInput) {
    return { status: Tasks.Status.Created, body: task };
  }
}
`,
  wrongBody: `${PROBE_IMPORTS}
export class WrongBody implements Pick<Server.TasksEndpoints, "getTask"> {
  getTask(_input: Tasks.GetTaskInput) {
    return { status: Tasks.Status.Ok, body: 5 };
  }
}
`,
  memoryStore: `import type { SeampactHooks } from "./generated/server/tasks/index.js";
import { createMemoryIdempotencyStore } from "${MEMORY_STORE_SOURCE}";

export const store: SeampactHooks["idempotencyStore"] = createMemoryIdempotencyStore();
`,
  typedRightParams: `import type { DeciderRequests } from "./generated/server/tasks/index.js";
import type * as Tasks from "./generated/types/tasks/index.js";

type RolesParams = NonNullable<DeciderRequests["roles"]["params"]>;

export const paramsAreTheRights: [RolesParams] extends [Tasks.schemas.RolesParams] ? true : false = true;
`,
} as const;

type ProbeName = keyof typeof PROBES;

interface Generated {
  readonly project: string;
  readonly files: Record<string, string>;
  readonly typeErrors: readonly string[];
}

/** Registers the shared generation proofs of one Node server target. */
export function describeGenerationProofs(subject: GenerationProofSubject): void {
  const project = projectDirectory(subject.testFileUrl, "generation-proofs");
  let generated: Generated | undefined;

  beforeAll(async () => {
    generated = await generate(subject, project);
  }, GENERATE_TIMEOUT_MILLISECONDS + TYPE_CHECK_TIMEOUT_MILLISECONDS);

  const state = (): Generated => {
    if (generated === undefined) throw new Error("the generation proofs did not generate");

    return generated;
  };

  describe("the generated errors", () => {
    test("an error is a union on its code: a declared code type-checks, an undeclared one does not", () => {
      expect(errorsOfProbe(state(), "declared")).toEqual([]);
      expect(errorsOfProbe(state(), "undeclaredCode")).toEqual([
        expect.stringContaining(`Type 'string' is not assignable to type '"api.not_found"'`),
      ]);
    });

    test("each error code of the registry is defined once, as a constant of the api", () => {
      const constants = readFileSync(join(project, "generated/types", API, "constants.ts"), "utf8");
      const codes = [...constants.matchAll(/^\s+\w+: "([a-z_.]+)",$/gm)].map((match) => match[1]);

      expect(codes.toSorted()).toEqual(Object.keys(readGoldenIr(API).errors).toSorted());
    });
  });

  describe("the handler types", () => {
    test("a handler whose status, error code or body the operation does not declare fails to type-check", () => {
      expect(errorsOfProbe(state(), "declared")).toEqual([]);
      expect(errorsOfProbe(state(), "undeclaredStatus")).toEqual([
        expect.stringContaining("Type '201' is not assignable to type '200'"),
      ]);
      expect(errorsOfProbe(state(), "wrongBody")).toEqual([
        expect.stringContaining("Type 'number' is not assignable"),
      ]);
    });
  });

  describe("the hooks", () => {
    test("the idempotency store is the documented IdempotencyStore interface and the reference store implements it", () => {
      expect(state().files["hooks.ts"]).toContain("readonly idempotencyStore: IdempotencyStore;");
      expect(state().files["hooks.ts"]).toMatch(/IdempotencyStore,[\s\S]*?from "@seampact\/hooks"/);
      expect(errorsOfProbe(state(), "memoryStore")).toEqual([]);
    });

    test("one neutral hook per concern, a registration export and the boot check", () => {
      const hooks = state().files["hooks.ts"] ?? "";
      const concerns = ["authenticate", "deciders", "scopeResolvers"];

      for (const concern of concerns) {
        expect(hooks.match(new RegExp(`readonly ${concern}:`, "g"))).toHaveLength(1);
      }

      expect(state().files["routes.ts"]).toContain('hookCheck: "error"');
      expect(state().files[subject.frameworkFile]).toContain("SeampactHooks");
      expect(state().files[subject.frameworkFile]).toContain(
        `export const ${subject.registration} =`,
      );
    });

    test("the decide request is typed per right and rule of the contract", () => {
      const ir = readGoldenIr(API);
      const hooks = state().files["hooks.ts"] ?? "";
      const requirements = [...Object.keys(ir.rights), ...Object.keys(ir.rules)];

      for (const requirement of requirements) {
        expect(hooks).toMatch(new RegExp(`readonly (${requirement}|"${requirement}"):`));
      }
    });

    test("the decide request of a right carries the right's declared params type", () => {
      expect(errorsOfProbe(state(), "typedRightParams")).toEqual([]);
    });
  });

  describe("the IR the target reads", () => {
    test("an irVersion outside the range the target reads is refused by name", async () => {
      const outcome = await generateFrom(
        subject,
        project,
        Object.assign({}, readGoldenIr(API), { irVersion: 99 }),
      );

      expect(outcome).toMatchObject({
        status: "refused",
        refusals: [{ code: "ir.version.unsupported", message: expect.stringContaining("99") }],
      });
    });

    test("an unknown IR field is ignored and an unknown kind is refused by name", async () => {
      const ir = readGoldenIr(API);
      const withUnknownField = await generateFrom(
        subject,
        project,
        Object.assign({}, ir, { futureMember: { anything: true } }),
      );
      const unchanged = await generateFrom(subject, project, ir);
      const withUnknownKind = await generateFrom(
        subject,
        project,
        Object.assign({}, ir, { kinds: [...ir.kinds, "futureKind"] }),
      );

      expect(withUnknownField).toEqual(unchanged);
      expect(withUnknownKind).toMatchObject({
        status: "refused",
        refusals: [{ code: "ir.kind.unsupported", message: expect.stringContaining("futureKind") }],
      });
    });
  });

  describe("the developer's controller", () => {
    test("no framework controller is generated: the developer implements the generated handler interface", () => {
      const generatedFiles = Object.entries(state().files);

      for (const [path, contents] of generatedFiles) {
        expect(path, `${path} is a controller`).not.toMatch(/controller/i);
        expect(contents, `${path} declares a controller`).not.toMatch(
          /@Controller\(|class \w*Controller\b/,
        );
      }

      expect(state().files["handlers.ts"]).toContain("export interface TasksEndpoints");
    });

    test("every generated path stays below the output directory", () => {
      for (const path of Object.keys(state().files)) {
        expect(path.startsWith("/") || path.split("/").includes("..")).toBe(false);
      }
    });
  });
}

async function generate(subject: GenerationProofSubject, project: string): Promise<Generated> {
  const written = await generateReferenceProject(project, subject.target, subject.serverOptions);

  for (const [name, source] of Object.entries(PROBES)) {
    writeFileSync(join(project, probeFile(name)), source);
  }

  const probeFiles = Object.keys(PROBES).map((name) => join(project, probeFile(name)));
  const outcome = await generateFrom(subject, project, readGoldenIr(API));

  if (outcome.status !== "generated") {
    throw new Error(`${subject.target.metadata.packageName} refused: ${JSON.stringify(outcome)}`);
  }

  return {
    project,
    files: Object.fromEntries(
      outcome.files.map((file: GeneratedFile) => [file.path, file.contents]),
    ),
    typeErrors: typeErrorsOf(project, [...written, ...probeFiles], REFERENCE_COMPILER_OPTIONS),
  };
}

function generateFrom(subject: GenerationProofSubject, project: string, ir: ContractIR) {
  return referenceLinks(project, API).then((links) =>
    subject.target.generate({
      ir,
      options: subject.serverOptions,
      links,
      outputDirectory: referenceServerOutput(project, API),
      artefacts: new Set(["boundary", "index"]),
    }),
  );
}

function probeFile(name: string): string {
  return `probe-${name}.ts`;
}

function errorsOfProbe(generated: Generated, name: ProbeName): string[] {
  return generated.typeErrors.filter((error) => error.includes(probeFile(name)));
}
