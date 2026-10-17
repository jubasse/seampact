import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { JsonValue } from "../ir-models/generate.ts";

// The golden scripts read the compiler through a dynamic import. The root TypeScript project forbids the
// parameter properties the compiler sources use (`erasableSyntaxOnly`), so a static import, even of a type, would
// make `pnpm typecheck` report the compiler's files. The adapter names the few members it calls and checks them at
// run time. Under Node, run with `--experimental-transform-types` for the same reason.

const COMPILER_ENTRY = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../packages/core/compiler/src/index.ts",
);

export type JsonObject = { [member: string]: JsonValue };

/** One api of a loaded workspace: the layers as the loader read them and the tree they merge into. */
export interface LoadedApi {
  name: string;
  merged: JsonObject;
  layers: { layer: string; file: string; tree: JsonObject }[];
}

export interface LoadedWorkspace {
  apis: LoadedApi[];
  /** Load and validate diagnostics, printed with file, line and column; empty when the contract is valid. */
  problems: string[];
}

export interface CompiledApi {
  api: string;
  /** The finalize output as the golden files hold it; absent when the api reported an error. */
  files?: { irText: string; sourceMapText: string };
  problems: string[];
}

export interface CompiledWorkspace {
  apis: CompiledApi[];
  /** Diagnostics that belong to no api (load, workspace entry). */
  problems: string[];
}

export interface GoldenCompiler {
  loadValidated(root: string, entry: string): LoadedWorkspace;
  /** `parts` replaces the pipeline's default parts (`PipelineOptions.parts`); the golden scripts leave it out. */
  compile(root: string, entry: string, parts?: object): CompiledWorkspace;
}

interface Diagnostics {
  length: number;
}

interface CompilerModule {
  loadFsReader(root: string): object;
  loadWorkspace(options: { reader: object; entry: string }): {
    workspace: { apis: LoadedApi[]; locations: object };
    diagnostics: Diagnostics;
  };
  validateWorkspace(workspace: object): {
    workspace: Diagnostics;
    apis: { api: string; diagnostics: Diagnostics }[];
  };
  compileWorkspace(options: { reader: object; entry: string; parts?: object }): {
    diagnostics: Diagnostics;
    locations: object;
    apis: {
      api: string;
      diagnostics: Diagnostics;
      locations: object;
      ir?: object;
      sourceMap?: object;
    }[];
  };
  printDiagnostics(diagnostics: Diagnostics, locations: object): string;
  finalizeSerializeJson(value: object): string;
}

const COMPILER_FUNCTIONS = [
  "loadFsReader",
  "loadWorkspace",
  "validateWorkspace",
  "compileWorkspace",
  "printDiagnostics",
  "finalizeSerializeJson",
];

function isCompilerModule(value: unknown): value is CompilerModule {
  if (typeof value !== "object" || value === null) return false;

  return COMPILER_FUNCTIONS.every(
    (name) => name in value && typeof Reflect.get(value, name) === "function",
  );
}

function printed(compiler: CompilerModule, diagnostics: Diagnostics, locations: object): string[] {
  if (diagnostics.length === 0) return [];

  return compiler
    .printDiagnostics(diagnostics, locations)
    .split("\n")
    .filter((line) => line !== "");
}

function goldenCompiler(compiler: CompilerModule): GoldenCompiler {
  return {
    loadValidated(root, entry) {
      const loaded = compiler.loadWorkspace({ reader: compiler.loadFsReader(root), entry });
      const problems = printed(compiler, loaded.diagnostics, loaded.workspace.locations);

      if (problems.length > 0) return { apis: [], problems };
      const validated = compiler.validateWorkspace(loaded.workspace);
      const diagnostics = [validated.workspace, ...validated.apis.map((api) => api.diagnostics)];

      return {
        apis: loaded.workspace.apis,
        problems: diagnostics.flatMap((each) =>
          printed(compiler, each, loaded.workspace.locations),
        ),
      };
    },

    compile(root, entry, parts) {
      const result = compiler.compileWorkspace({
        reader: compiler.loadFsReader(root),
        entry,
        ...(parts === undefined ? {} : { parts }),
      });

      return {
        problems: printed(compiler, result.diagnostics, result.locations),
        apis: result.apis.map((api) => ({
          api: api.api,
          problems: printed(compiler, api.diagnostics, api.locations),
          ...(api.ir === undefined || api.sourceMap === undefined
            ? {}
            : {
                files: {
                  irText: compiler.finalizeSerializeJson(api.ir),
                  sourceMapText: compiler.finalizeSerializeJson(api.sourceMap),
                },
              }),
        })),
      };
    },
  };
}

/** The compiler's entry module, loaded once. */
export async function loadGoldenCompiler(): Promise<GoldenCompiler> {
  const loaded: unknown = await import(pathToFileURL(COMPILER_ENTRY).href);

  if (!isCompilerModule(loaded)) {
    throw new Error(`${COMPILER_ENTRY} does not export the members the golden scripts call`);
  }

  return goldenCompiler(loaded);
}
