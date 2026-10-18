import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { GeneratedFile, Target } from "@seampact/codegen-core";
import type { ContractIR } from "@seampact/spec/ir";
import ts from "typescript";
import { target as adonisTarget } from "./index.js";

// Test support: generates the reference contract's types, validators and AdonisJS boundary into a consumer layout
// under the package's git-ignored `.vitest/`, against one AdonisJS major. The project's `node_modules` links the
// workspace packages a consumer installs and that major's `@adonisjs/core`; zod resolves from this package.

const REPOSITORY_ROOT = new URL("../../../../", import.meta.url);
const PACKAGE_MODULES = new URL("../node_modules/", import.meta.url);

export const REFERENCE_APIS = ["tasks", "tasksService"] as const;

/** The AdonisJS majors the target serves, each the devDependency that installs it. */
export const ADONIS_MAJORS = { 7: "@adonisjs/core", 6: "@adonisjs/core-6" } as const;

export type AdonisMajor = keyof typeof ADONIS_MAJORS;

const LINKED_PACKAGES = {
  "@seampact/codegen-ts": "packages/targets/codegen-ts",
  "@seampact/codegen-zod": "packages/targets/codegen-zod",
  "@seampact/hooks": "packages/runtime/hooks",
};

/** The consumer's compiler options: strict and NodeNext, as an AdonisJS app sets them. */
export const REFERENCE_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2024,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  verbatimModuleSyntax: true,
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
  major: AdonisMajor,
  adonisOptions: Readonly<Record<string, unknown>>,
): Promise<string[]> {
  rmSync(project, { recursive: true, force: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), '{ "type": "module" }\n');
  linkPackages(project, major);

  const providers = await linkedProviders(project);
  const written = await Promise.all(
    REFERENCE_APIS.map((api) => generateApi(project, api, providers, adonisOptions)),
  );

  return written.flat();
}

/** The type errors of a set of files, formatted with their location. */
export function typeErrorsOf(project: string, files: readonly string[]): string[] {
  const program = ts.createProgram(files, REFERENCE_COMPILER_OPTIONS);

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

  if (typesDescriptor === undefined || validatorsDescriptor === undefined) {
    throw new Error("a link is missing");
  }

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
  adonisOptions: Readonly<Record<string, unknown>>,
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
      await generated(adonisTarget, {
        ir,
        options: adonisOptions,
        links: linksOf(providers, ir, api),
        artefacts: new Set(["boundary"]),
      }),
    ),
  ];
}

// The workspace packages, and the major's `@adonisjs/core` under its own name.
function linkPackages(project: string, major: AdonisMajor): void {
  const links: [string, string][] = [
    ...Object.entries(LINKED_PACKAGES).map(([name, directory]): [string, string] => [
      name,
      fileURLToPath(new URL(directory, REPOSITORY_ROOT)),
    ]),
    ["@adonisjs/core", fileURLToPath(new URL(ADONIS_MAJORS[major], PACKAGE_MODULES))],
  ];

  for (const [name, directory] of links) {
    const link = join(project, "node_modules", name);

    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(directory, link, "dir");
  }
}

async function linkedTarget(project: string, name: string): Promise<Target> {
  const module: { target: Target } = await import(
    pathToFileURL(join(project, "node_modules", name, "src/index.ts")).href
  );

  return module.target;
}
