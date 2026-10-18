import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { GeneratedFile, Target } from "@seampact/codegen-core";
import type { ContractIR } from "@seampact/spec/ir";
import ts from "typescript";
import { target as nestjsTarget } from "./index.js";

// Test support: generates the reference contract's types, validators and NestJS boundary into a consumer layout
// under the package's git-ignored `.vitest/`. The generated code resolves NestJS, rxjs and zod from this package's
// devDependencies, and the project's `node_modules` links the workspace packages a consumer installs, which this
// package does not depend on (ADR 0009 "Dependency rules").

const REPOSITORY_ROOT = new URL("../../../../", import.meta.url);

export const REFERENCE_APIS = ["tasks", "tasksService"] as const;

const LINKED_PACKAGES = {
  "@seampact/codegen-ts": "packages/targets/codegen-ts",
  "@seampact/codegen-zod": "packages/targets/codegen-zod",
  "@seampact/hooks": "packages/runtime/hooks",
};

/** The consumer's compiler options: strict, NodeNext, and NestJS's legacy decorators. */
export const REFERENCE_COMPILER_OPTIONS: ts.CompilerOptions = {
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

/** A project directory under the package's `.vitest/`. */
export function projectDirectory(name: string): string {
  return fileURLToPath(new URL(`../.vitest/${name}/`, import.meta.url));
}

/** Writes both reference apis' generated trees into a fresh project; returns every file written. */
export async function generateReferenceProject(
  project: string,
  nestjsOptions: Readonly<Record<string, unknown>>,
): Promise<string[]> {
  rmSync(project, { recursive: true, force: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), '{ "type": "module" }\n');
  linkWorkspacePackages(project);

  const providers = await linkedProviders(project);
  const written = await Promise.all(
    REFERENCE_APIS.map((api) => generateApi(project, api, providers, nestjsOptions)),
  );

  return written.flat();
}

/** The type errors of a set of files, formatted with their location. */
export function typeErrorsOf(
  project: string,
  files: readonly string[],
  options: ts.CompilerOptions,
): string[] {
  const program = ts.createProgram(files, options);

  return formatted(project, ts.getPreEmitDiagnostics(program));
}

/** Compiles the files to JavaScript under `outDir`; returns the type and emit errors. */
export function emitProject(project: string, files: readonly string[], outDir: string): string[] {
  const program = ts.createProgram(files, {
    ...REFERENCE_COMPILER_OPTIONS,
    noEmit: false,
    rootDir: project,
    outDir,
  });
  const emitted = program.emit();

  return formatted(project, [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics]);
}

function formatted(project: string, diagnostics: readonly ts.Diagnostic[]): string[] {
  return diagnostics.map((diagnostic) =>
    ts.formatDiagnostic(diagnostic, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => project,
      getNewLine: () => "\n",
    }),
  );
}

export function readGoldenIr(api: string): ContractIR {
  return JSON.parse(
    readFileSync(new URL(`fixtures/golden/reference/${api}.ir.json`, REPOSITORY_ROOT), "utf8"),
  );
}

function writeFiles(project: string, directory: string, files: readonly GeneratedFile[]): string[] {
  return files.map((file) => {
    const path = join(project, directory, file.path);

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

interface Providers {
  readonly types: Target;
  readonly validators: Target;
}

async function linkedProviders(project: string): Promise<Providers> {
  return {
    types: await linkedTarget(project, "@seampact/codegen-ts"),
    validators: await linkedTarget(project, "@seampact/codegen-zod"),
  };
}

/** The types and validators links of a reference api, as the generated project places them. */
export async function referenceLinks(
  project: string,
  api: string,
): Promise<Parameters<Target["generate"]>[0]["links"]> {
  return linksOf(await linkedProviders(project), readGoldenIr(api), api);
}

function linksOf(
  providers: Providers,
  ir: ContractIR,
  api: string,
): Parameters<Target["generate"]>[0]["links"] {
  const types = providers.types.describe(ir, {});
  const validators = providers.validators.describe(ir, {});

  if (types.status !== "described" || validators.status !== "described") {
    throw new Error(`a provider refused to describe ${api}`);
  }

  const typesDescriptor = types.descriptors.types;
  const validatorsDescriptor = validators.descriptors.validators;

  if (typesDescriptor === undefined || validatorsDescriptor === undefined)
    throw new Error("a link is missing");

  return {
    types: {
      descriptor: typesDescriptor,
      location: { kind: "relative", path: `../../types/${api}` },
    },
    validators: {
      descriptor: validatorsDescriptor,
      location: { kind: "relative", path: `../../validators/${api}` },
    },
  };
}

async function generateApi(
  project: string,
  api: string,
  providers: Providers,
  nestjsOptions: Readonly<Record<string, unknown>>,
): Promise<string[]> {
  const ir = readGoldenIr(api);
  const providerRequest = { ir, options: {}, links: {} };

  return [
    ...writeFiles(
      project,
      `generated/types/${api}`,
      await generated(providers.types, { ...providerRequest, artefacts: new Set(["types"]) }),
    ),
    ...writeFiles(
      project,
      `generated/validators/${api}`,
      await generated(providers.validators, {
        ...providerRequest,
        artefacts: new Set(["validators"]),
      }),
    ),
    ...writeFiles(
      project,
      `generated/server/${api}`,
      await generated(nestjsTarget, {
        ir,
        options: nestjsOptions,
        links: linksOf(providers, ir, api),
        artefacts: new Set(["boundary"]),
      }),
    ),
  ];
}

function linkWorkspacePackages(project: string): void {
  for (const [name, directory] of Object.entries(LINKED_PACKAGES)) {
    const link = join(project, "node_modules", name);

    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(fileURLToPath(new URL(directory, REPOSITORY_ROOT)), link, "dir");
  }
}

async function linkedTarget(project: string, name: string): Promise<Target> {
  const module: { target: Target } = await import(
    pathToFileURL(join(project, "node_modules", name, "src/index.ts")).href
  );

  return module.target;
}
