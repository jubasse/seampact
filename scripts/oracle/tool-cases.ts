import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { OracleApiResult, OracleCompilation, OracleCompiler } from "./compiler.ts";
import type { ExpectedFiles } from "./expected-text.ts";
import { entryFileOf, EXPECTED_ROOT, FIXTURES_ROOT } from "./fixtures.ts";
import { type BundleSpec, bundleFiles } from "./tool-bundle.ts";
import { type CliSpec, cliFiles, cliSpecProblems } from "./tool-cli.ts";
import { DEFAULT_DIFF_OPTIONS, diffFiles, type SideIrs } from "./tool-diff.ts";
import type { OracleTools } from "./tool-modules.ts";
import { type MergeCase, mergeFiles } from "./tool-openapi.ts";

// The cases of the tools that have a case file of their own (`merge.json`, `bundle.json`, `cli.json`, or a
// `before/` and an `after/`), found below `fixtures/`, and the expected files of each (README, "Tool outputs").

export type ToolKind = "merge" | "bundle" | "cli" | "diff";

export interface ToolCase {
  /** The path under `fixtures/`, `/` separated; the expected files sit under `fixtures/expected/<path>/`. */
  path: string;
  directory: string;
  kind: ToolKind;
}

export const MERGE_FILE = "merge.json";
export const BUNDLE_FILE = "bundle.json";
export const CLI_FILE = "cli.json";
export const DIFF_OPTIONS_FILE = "diff.options.json";
const BEFORE_DIRECTORY = "before";
const AFTER_DIRECTORY = "after";

function kindOf(directory: string): ToolKind | undefined {
  if (existsSync(join(directory, CLI_FILE))) return "cli";

  if (existsSync(join(directory, MERGE_FILE))) return "merge";

  if (existsSync(join(directory, BUNDLE_FILE))) return "bundle";

  if (existsSync(join(directory, BEFORE_DIRECTORY)) && existsSync(join(directory, AFTER_DIRECTORY)))
    return "diff";

  return undefined;
}

function walk(directory: string, found: ToolCase[]): void {
  const kind = kindOf(directory);
  const path = relative(FIXTURES_ROOT, directory).split("\\").join("/");

  if (kind !== undefined) found.push({ path, directory, kind });

  // A CLI case's tree is the project the command runs on, not a place for cases.
  if (kind === "cli") return;

  for (const name of readdirSync(directory).sort()) {
    const child = join(directory, name);

    if (child !== EXPECTED_ROOT && name !== "node_modules" && statSync(child).isDirectory())
      walk(child, found);
  }
}

export function discoverToolCases(): ToolCase[] {
  const found: ToolCase[] = [];

  walk(FIXTURES_ROOT, found);

  return found;
}

export function readCaseJson(directory: string, file: string): unknown {
  return JSON.parse(readFileSync(join(directory, file), "utf8"));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Compiles directories once for the cases that read several. */
export interface CompileCache {
  compile(directory: string): OracleCompilation;
}

export function compileCacheOf(compiler: OracleCompiler): CompileCache {
  const compilations = new Map<string, OracleCompilation>();

  return {
    compile(directory) {
      const cached = compilations.get(directory);

      if (cached !== undefined) return cached;

      const compilation = compiler.compile(directory, entryFileOf(directory) ?? "workspace.yaml");

      compilations.set(directory, compilation);

      return compilation;
    },
  };
}

function irOf(apis: readonly OracleApiResult[], api: string, where: string): object {
  const text = apis.find((candidate) => candidate.api === api)?.irText;

  if (text === undefined) throw new Error(`${where}: the api ${api} compiles to no IR`);

  return JSON.parse(text);
}

function mergeCaseOf(directory: string, cache: CompileCache, path: string): MergeCase {
  const raw = readCaseJson(directory, MERGE_FILE);

  if (!isRecord(raw) || typeof raw.name !== "string" || !Array.isArray(raw.inputs))
    throw new Error(`${path}/${MERGE_FILE}: expected { name, prefix, inputs }`);

  const inputs = raw.inputs.map((input: unknown) => {
    if (!isRecord(input) || typeof input.fixture !== "string" || typeof input.api !== "string")
      throw new Error(`${path}/${MERGE_FILE}: an input needs a fixture and an api`);

    const apis = cache.compile(join(FIXTURES_ROOT, input.fixture)).apis;
    const ir = irOf(apis, input.api, `${path}/${MERGE_FILE} input ${input.fixture}`);
    const kept: unknown = input.operations;

    return {
      ir: Array.isArray(kept) ? keepOperations(ir, kept) : ir,
      ...(typeof input.document === "string" ? { document: input.document } : {}),
    };
  });
  const prefix: unknown = raw.prefix;

  return {
    name: raw.name,
    prefix: isRecord(prefix) ? (prefix as Record<string, string>) : {},
    ...(raw.emitter === undefined ? {} : { emitter: raw.emitter }),
    inputs,
  };
}

function keepOperations(ir: object, ids: readonly unknown[]): object {
  const operations: unknown = Reflect.get(ir, "operations");

  if (!Array.isArray(operations)) throw new Error("an IR with no operations list");

  return { ...ir, operations: operations.filter((operation) => ids.includes(operation?.id)) };
}

function sideIrs(cache: CompileCache, directory: string, where: string): SideIrs {
  const { apis } = cache.compile(directory);

  return new Map(apis.map(({ api }) => [api, irOf(apis, api, where)]));
}

function diffFilesOf(tools: OracleTools, cache: CompileCache, toolCase: ToolCase): ExpectedFiles {
  const optionsFile = join(toolCase.directory, DIFF_OPTIONS_FILE);
  const options = existsSync(optionsFile)
    ? readCaseJson(toolCase.directory, DIFF_OPTIONS_FILE)
    : DEFAULT_DIFF_OPTIONS;
  const side = (name: string) =>
    sideIrs(cache, join(toolCase.directory, name), `${toolCase.path}/${name}`);

  return diffFiles(tools, side(BEFORE_DIRECTORY), side(AFTER_DIRECTORY), options as object);
}

/** The expected files of one tool case. */
export async function toolCaseFiles(
  tools: OracleTools,
  cache: CompileCache,
  toolCase: ToolCase,
): Promise<ExpectedFiles> {
  const { directory, kind, path } = toolCase;

  if (kind === "merge") return mergeFiles(tools, mergeCaseOf(directory, cache, path));

  if (kind === "diff") return diffFilesOf(tools, cache, toolCase);

  if (kind === "bundle") {
    const spec = readCaseJson(directory, BUNDLE_FILE) as BundleSpec;

    return bundleFiles(
      tools,
      directory,
      spec,
      spec.workspace ?? entryFileOf(directory) ?? "workspace.yaml",
    );
  }

  const spec = readCaseJson(directory, CLI_FILE);
  const problems = cliSpecProblems(spec);

  if (problems.length > 0) throw new Error(`${path}/${CLI_FILE}: ${problems.join("; ")}`);

  return cliFiles(tools, directory, spec as CliSpec);
}
