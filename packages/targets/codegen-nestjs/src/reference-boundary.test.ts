import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { GeneratedFile, Target } from "@seampact/codegen-core";
import type { ContractIR } from "@seampact/spec/ir";
import ts from "typescript";
import { beforeAll, describe, expect, test } from "vitest";
import { target as nestjsTarget } from "./index.js";

// The consumer layout under the package's git-ignored `.vitest/`: the generated code resolves NestJS, rxjs and zod
// from this package's devDependencies, and its `node_modules` links the workspace packages a consumer installs,
// which this package does not depend on (ADR 0009 "Dependency rules").
const PROJECT = fileURLToPath(new URL("../.vitest/reference-boundary/", import.meta.url));
const REPOSITORY_ROOT = new URL("../../../../", import.meta.url);
const APIS = ["tasks", "tasksService"] as const;
const LINKED_PACKAGES = {
  "@seampact/codegen-ts": "packages/targets/codegen-ts",
  "@seampact/codegen-zod": "packages/targets/codegen-zod",
  "@seampact/hooks": "packages/runtime/hooks",
};

let typesTarget: Target;
let validatorsTarget: Target;

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2024,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  verbatimModuleSyntax: true,
  experimentalDecorators: true,
  skipLibCheck: true,
  noEmit: true,
  types: ["node"],
};

function readGoldenIr(api: string): ContractIR {
  return JSON.parse(
    readFileSync(new URL(`fixtures/golden/reference/${api}.ir.json`, REPOSITORY_ROOT), "utf8"),
  );
}

function writeFiles(directory: string, files: readonly GeneratedFile[]): string[] {
  return files.map((file) => {
    const path = join(PROJECT, directory, file.path);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.contents);

    return path;
  });
}

async function generated(
  target: Target,
  request: Parameters<Target["generate"]>[0],
): Promise<readonly GeneratedFile[]> {
  const outcome = await target.generate(request);

  if (outcome.status !== "generated") {
    throw new Error(
      `${target.metadata.packageName} refused: ${JSON.stringify(outcome.refusals, null, 2)}`,
    );
  }

  return outcome.files;
}

async function generateApi(api: string): Promise<string[]> {
  const ir = readGoldenIr(api);
  const types = typesTarget.describe(ir, {});
  const validators = validatorsTarget.describe(ir, {});

  if (types.status !== "described" || validators.status !== "described") {
    throw new Error(`a provider refused to describe ${api}`);
  }

  const typesDescriptor = types.descriptors.types;
  const validatorsDescriptor = validators.descriptors.validators;

  if (typesDescriptor === undefined || validatorsDescriptor === undefined)
    throw new Error("a link is missing");

  return [
    ...writeFiles(
      `generated/types/${api}`,
      await generated(typesTarget, { ir, options: {}, links: {}, artefacts: new Set(["types"]) }),
    ),
    ...writeFiles(
      `generated/validators/${api}`,
      await generated(validatorsTarget, {
        ir,
        options: {},
        links: {},
        artefacts: new Set(["validators"]),
      }),
    ),
    ...writeFiles(
      `generated/server/${api}`,
      await generated(nestjsTarget, {
        ir,
        options: { bodyValidation: true },
        links: {
          types: {
            descriptor: typesDescriptor,
            location: { kind: "relative", path: `../../types/${api}` },
          },
          validators: {
            descriptor: validatorsDescriptor,
            location: { kind: "relative", path: `../../validators/${api}` },
          },
        },
        artefacts: new Set(["boundary"]),
      }),
    ),
  ];
}

function linkWorkspacePackages(): void {
  for (const [name, directory] of Object.entries(LINKED_PACKAGES)) {
    const link = join(PROJECT, "node_modules", name);

    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(fileURLToPath(new URL(directory, REPOSITORY_ROOT)), link, "dir");
  }
}

async function linkedTarget(name: string): Promise<Target> {
  const module: { target: Target } = await import(
    pathToFileURL(join(PROJECT, "node_modules", name, "src/index.ts")).href
  );

  return module.target;
}

let files: string[] = [];

beforeAll(async () => {
  rmSync(PROJECT, { recursive: true, force: true });
  mkdirSync(PROJECT, { recursive: true });
  writeFileSync(join(PROJECT, "package.json"), '{ "type": "module" }\n');
  linkWorkspacePackages();
  typesTarget = await linkedTarget("@seampact/codegen-ts");
  validatorsTarget = await linkedTarget("@seampact/codegen-zod");
  files = (await Promise.all(APIS.map(generateApi))).flat();
});

describe("the generated reference boundary compiles", () => {
  test("both apis' types, validators and NestJS boundary type-check together", () => {
    const program = ts.createProgram(files, COMPILER_OPTIONS);
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) =>
      ts.formatDiagnostic(diagnostic, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => PROJECT,
        getNewLine: () => "\n",
      }),
    );

    expect(diagnostics).toEqual([]);
  });

  test("an unknown option is refused by name", () => {
    expect(nestjsTarget.parseOptions({ responses: "loose", extra: true })).toMatchObject({
      status: "refused",
      refusals: [{ code: "options.unknown" }, { code: "options.responses.invalid" }],
    });
  });
});
