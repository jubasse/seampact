import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { OracleCompilation, OracleCompiler } from "./compiler.ts";
import { EXPECTED_ROOT, type ExcludedFixtures, type OracleFixture } from "./fixtures.ts";

// The expected outputs of a fixture as files, keyed by their path under `fixtures/expected/<fixture path>/`:
// `diagnostics.json`, `ir/<api>.json`, `source-map/<api>.json`, `halves/<api>/<NN>-<half>.json`.

export type ExpectedFiles = Map<string, string>;

const JSON_INDENT = 2;

const jsonText = (value: unknown): string => `${JSON.stringify(value, null, JSON_INDENT)}\n`;

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
  for (const { api, half, delta } of compilation.halves) {
    const number = String(compiler.halveNames.indexOf(half) + 1).padStart(2, "0");

    files.set(`halves/${api}/${number}-${half}.json`, jsonText(delta));
  }
}

/** The expected files of one fixture. */
export function expectedFilesOf(
  compiler: OracleCompiler,
  fixture: OracleFixture,
  excluded: ExcludedFixtures,
): ExpectedFiles {
  const compilation = compiler.compile(fixture.directory, fixture.entry);
  const files: ExpectedFiles = new Map([["diagnostics.json", diagnosticsText(compilation)]]);

  for (const { api, irText, sourceMapText } of compilation.apis) {
    if (irText !== undefined) files.set(`ir/${api}.json`, irText);

    if (sourceMapText !== undefined) files.set(`source-map/${api}.json`, sourceMapText);
  }

  if (excluded.halves[fixture.path] === undefined) halveFiles(compiler, compilation, files);

  return files;
}

export const expectedDirectoryOf = (fixture: OracleFixture): string =>
  join(EXPECTED_ROOT, fixture.path);

const OWN_ENTRIES = ["diagnostics.json", "ir", "source-map", "halves"] as const;

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
export function readExpectedFiles(fixture: OracleFixture): ExpectedFiles {
  const directory = expectedDirectoryOf(fixture);
  const names: string[] = [];

  for (const entry of OWN_ENTRIES) filesBelow(join(directory, entry), entry, names);

  return new Map(names.sort().map((name) => [name, readFileSync(join(directory, name), "utf8")]));
}

/** Replaces a fixture's expected files; its own files only, never a nested fixture's tree. */
export function writeExpectedFiles(fixture: OracleFixture, files: ExpectedFiles): void {
  const directory = expectedDirectoryOf(fixture);

  for (const name of OWN_ENTRIES) rmSync(join(directory, name), { recursive: true, force: true });

  for (const [name, text] of files) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), text);
  }
}
