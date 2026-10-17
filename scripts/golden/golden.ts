import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { GoldenCompiler } from "./compiler.ts";
import { generateScaleFiles, SCALE_DIRECTORY } from "./scale.ts";

// The golden checker: compiles every case, writes each api's IR and side table as `finalizeSerializeJson` gives
// them, and compares the result with the committed files byte for byte. A file nobody generates is stale.

export const GOLDEN_DIRECTORY = "fixtures/golden";

export interface GoldenCase {
  /** The directory name under `fixtures/golden`. */
  name: string;
  /** The workspace root, relative to the repository. */
  source: string;
  /** The entry file under `source`. */
  entry: string;
}

// Cases are added with the golden IR they produce (PR 2).
export const GOLDEN_CASES: GoldenCase[] = [];

/** Directories the generators own whole: a file there that they do not write is stale. */
export const GENERATED_DIRECTORIES = [
  GOLDEN_DIRECTORY,
  `${SCALE_DIRECTORY}/inventory/generated`,
  `${SCALE_DIRECTORY}/billing/generated`,
];

export const WRITE_COMMAND =
  "node --experimental-transform-types --import ./scripts/ir-models/register.ts scripts/golden/cli.ts --write";

export interface GoldenFiles {
  files: Map<string, string>;
  /** Why a case produced no file; a case with a problem is never written. */
  problems: string[];
}

/** The golden files of the cases, keyed by repository-relative path. */
export function goldenFiles(
  root: string,
  cases: readonly GoldenCase[],
  compiler: GoldenCompiler,
  parts?: object,
): GoldenFiles {
  const files = new Map<string, string>();
  const problems: string[] = [];

  for (const goldenCase of cases) {
    const compiled = compiler.compile(join(root, goldenCase.source), goldenCase.entry, parts);

    problems.push(...compiled.problems.map((problem) => `${goldenCase.name}: ${problem}`));

    for (const api of compiled.apis) {
      problems.push(...api.problems.map((problem) => `${goldenCase.name}/${api.api}: ${problem}`));

      if (api.files === undefined) {
        // A diagnostic already says why; only an unexplained absence needs a line of its own.
        if (api.problems.length === 0 && compiled.problems.length === 0) {
          problems.push(`${goldenCase.name}/${api.api}: the compiler produced no IR`);
        }

        continue;
      }

      files.set(`${GOLDEN_DIRECTORY}/${goldenCase.name}/${api.api}.ir.json`, api.files.irText);
      files.set(
        `${GOLDEN_DIRECTORY}/${goldenCase.name}/${api.api}.source-map.json`,
        api.files.sourceMapText,
      );
    }
  }

  return { files, problems };
}

/** Every file the generators write: the golden files of the cases and the generated part of the scale fixture. */
export function allGeneratedFiles(
  root: string,
  compiler: GoldenCompiler,
  cases: readonly GoldenCase[] = GOLDEN_CASES,
): GoldenFiles {
  const golden = goldenFiles(root, cases, compiler);

  return {
    files: new Map([...generateScaleFiles(), ...golden.files]),
    problems: golden.problems,
  };
}

function filesBelow(root: string, directory: string): string[] {
  const absolute = join(root, directory);

  if (!existsSync(absolute)) return [];

  return readdirSync(absolute, { withFileTypes: true })
    .sort((left, right) => (left.name < right.name ? -1 : 1))
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesBelow(root, `${directory}/${entry.name}`)
        : [`${directory}/${entry.name}`],
    );
}

/** The files under the generated directories that no generator writes. */
export function findUnlistedFiles(
  files: ReadonlyMap<string, string>,
  root: string,
  directories: readonly string[] = GENERATED_DIRECTORIES,
): string[] {
  return directories
    .flatMap((directory) => filesBelow(root, directory))
    .filter((path) => !files.has(path));
}
