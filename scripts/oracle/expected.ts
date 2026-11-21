import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { installCallRecording } from "./call-recording.ts";
import { loadOracleCompiler, type OracleCompilation, type OracleCompiler } from "./compiler.ts";
import { type ExpectedFiles, jsonText } from "./expected-text.ts";
import { EXPECTED_ROOT, type ExcludedFixtures, OWN_EXPECTED_NAMES } from "./fixtures.ts";
import type { OracleTarget } from "./targets.ts";
import {
  type CompileCache,
  compileCacheOf,
  OPENAPI_OPTIONS_FILE,
  readCaseJson,
  toolCaseFiles,
} from "./tool-cases.ts";
import { lintFiles } from "./tool-lint.ts";
import { loadOracleTools, type OracleTools } from "./tool-modules.ts";
import { openApiFiles } from "./tool-openapi.ts";

// The expected outputs of a target as files, keyed by their path under `fixtures/expected/<path>/`: of a fixture
// `diagnostics.json`, `ir/<api>.json`, `source-map/<api>.json`, `halves/<api>/<NN>-<half>.json`, and when not empty
// `halves/<api>/<NN>-<half>.diagnostics.json` and `schema-calls/<api>.json`, then the `openapi/` and `lint/` files of
// each api that compiled; of a tool case the files of its unit (README, "Tool outputs").

export type { ExpectedFiles };

export interface OracleContext {
  compiler: OracleCompiler;
  tools: OracleTools;
  cache: CompileCache;
}

export async function loadOracleContext(): Promise<OracleContext> {
  // Before the compiler's modules load: the hook wraps the functions the CLI cases record.
  installCallRecording();

  const compiler = await loadOracleCompiler();

  return { compiler, tools: await loadOracleTools(), cache: compileCacheOf(compiler) };
}

function diagnosticsText(compilation: OracleCompilation): string {
  return jsonText({
    workspace: compilation.diagnostics,
    apis: compilation.apis.map(({ api, diagnostics }) => ({ api, diagnostics })),
  });
}

function halveFiles(
  compiler: OracleCompiler,
  compilation: OracleCompilation,
  files: ExpectedFiles,
): void {
  for (const { api, half, delta, diagnostics } of compilation.halves) {
    const number = String(compiler.halveNames.indexOf(half) + 1).padStart(2, "0");

    files.set(`halves/${api}/${number}-${half}.json`, jsonText(delta));

    if (diagnostics.length > 0)
      files.set(`halves/${api}/${number}-${half}.diagnostics.json`, jsonText(diagnostics));
  }

  for (const { api, calls } of compilation.schemaCalls)
    files.set(`schema-calls/${api}.json`, jsonText(calls));
}

async function fixtureFiles(
  context: OracleContext,
  target: OracleTarget,
  excluded: ExcludedFixtures,
): Promise<ExpectedFiles> {
  const { fixture } = target;

  if (fixture === undefined) return new Map();

  const { compiler, tools } = context;
  const compilation = compiler.compile(fixture.directory, fixture.entry);
  const files: ExpectedFiles = new Map([["diagnostics.json", diagnosticsText(compilation)]]);
  const optionsFile = join(fixture.directory, OPENAPI_OPTIONS_FILE);
  const rawOptions = existsSync(optionsFile)
    ? readCaseJson(fixture.directory, OPENAPI_OPTIONS_FILE)
    : undefined;

  for (const { api, irText, sourceMapText } of compilation.apis) {
    if (irText !== undefined) {
      files.set(`ir/${api}.json`, irText);

      for (const [name, text] of openApiFiles(tools, api, irText, rawOptions))
        files.set(name, text);
    }

    if (sourceMapText !== undefined) files.set(`source-map/${api}.json`, sourceMapText);
  }

  for (const [name, text] of await lintFiles(tools, compilation.apis)) files.set(name, text);

  if (excluded.halves[fixture.path] === undefined) halveFiles(compiler, compilation, files);

  return files;
}

/** The expected files of one target. */
export async function expectedFilesOf(
  context: OracleContext,
  target: OracleTarget,
  excluded: ExcludedFixtures,
): Promise<ExpectedFiles> {
  const files = await fixtureFiles(context, target, excluded);

  if (target.tool === undefined) return files;

  for (const [name, text] of await toolCaseFiles(context.tools, context.cache, target.tool))
    files.set(name, text);

  return files;
}

export const expectedDirectoryOf = (target: OracleTarget): string =>
  join(EXPECTED_ROOT, target.path);

const OWN_ENTRIES = OWN_EXPECTED_NAMES;

const GLOBAL_EXPECTED_FILES: readonly string[] = [
  "differences.yaml",
  "rule-coverage.json",
  "diff-table.json",
];

function expectedFilePaths(directory: string, prefix: string, found: string[]): void {
  for (const name of readdirSync(directory)) {
    const child = join(directory, name);
    const path = prefix === "" ? name : `${prefix}/${name}`;

    if (statSync(child).isDirectory()) expectedFilePaths(child, path, found);
    else found.push(path);
  }
}

/**
 * The directories under `fixtures/expected/` holding an expected file that no target claims: a file is claimed when
 * the directory above its first own entry name (`ir`, `openapi`, ...) is a target, at any depth.
 */
export function unclaimedExpectedDirectories(targets: ReadonlySet<string>): string[] {
  const files: string[] = [];

  expectedFilePaths(EXPECTED_ROOT, "", files);

  const claimed = (file: string): boolean => {
    const segments = file.split("/");

    return (
      segments.some(
        (segment, index) =>
          index > 0 &&
          OWN_ENTRIES.includes(segment) &&
          targets.has(segments.slice(0, index).join("/")),
      ) || GLOBAL_EXPECTED_FILES.includes(file)
    );
  };

  return [...new Set(files.filter((file) => !claimed(file)).map((file) => dirname(file)))].sort();
}

function filesBelow(path: string, name: string, found: string[]): void {
  let isDirectory: boolean;

  try {
    isDirectory = statSync(path).isDirectory();
  } catch (error) {
    // A fixture with no expected output yet has no entry on disk: that is a difference, not a failure here.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;

    throw error;
  }

  if (!isDirectory) {
    found.push(name);

    return;
  }

  for (const child of readdirSync(path)) filesBelow(join(path, child), `${name}/${child}`, found);
}

/** The expected files on disk, empty when the fixture has none. Its own entries only: a nested fixture's tree sits below. */
export function readExpectedFiles(fixture: OracleTarget): ExpectedFiles {
  const directory = expectedDirectoryOf(fixture);
  const names: string[] = [];

  for (const entry of OWN_ENTRIES) filesBelow(join(directory, entry), entry, names);

  return new Map(names.sort().map((name) => [name, readFileSync(join(directory, name), "utf8")]));
}

/** Replaces a fixture's expected files; its own files only, never a nested fixture's tree. */
export function writeExpectedFiles(fixture: OracleTarget, files: ExpectedFiles): void {
  const directory = expectedDirectoryOf(fixture);

  for (const name of OWN_ENTRIES) rmSync(join(directory, name), { recursive: true, force: true });

  for (const [name, text] of files) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), text);
  }
}
