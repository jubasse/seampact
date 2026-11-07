import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { GoldenCompiler } from "./compiler.ts";
import { type GoldenOpenApi, goldenOpenApiFiles } from "./openapi.ts";
import { PACK_VARIANTS, packVariantFiles } from "./pack-variants.ts";
import { generateScaleFiles, SCALE_DIRECTORY } from "./scale.ts";

// The golden checker: compiles every case, writes each api's IR and side table as `finalizeSerializeJson` gives
// them and the OpenAPI documents of each IR, and compares the result with the committed files byte for byte. A file nobody generates is stale.

export const GOLDEN_DIRECTORY = "fixtures/golden";

export interface GoldenCase {
  /** The directory name under `fixtures/golden`. */
  name: string;
  /** The workspace root, relative to the repository. */
  source: string;
  /** The entry file under `source`. */
  entry: string;
}

export const GOLDEN_CASES: GoldenCase[] = [
  { name: "reference", source: "fixtures/reference", entry: "workspace.yaml" },
  { name: "bodies", source: `${GOLDEN_DIRECTORY}/bodies/contract`, entry: "workspace.yaml" },
  { name: "agreement", source: "fixtures/validator-agreement", entry: "api.yaml" },
  {
    name: "every-default",
    source: `${GOLDEN_DIRECTORY}/every-default/contract`,
    entry: "workspace.yaml",
  },
  {
    name: "extensions",
    source: `${GOLDEN_DIRECTORY}/extensions/contract`,
    entry: "workspace.yaml",
  },
  ...PACK_VARIANTS.map(({ name }) => ({
    name: `pack-${name}`,
    source: `${GOLDEN_DIRECTORY}/pack-${name}/contract`,
    entry: "workspace.yaml",
  })),
];

const REFERENCE_DIRECTORY = "fixtures/reference";

/** The directory of a hand-written case that holds its contract source; the generators leave it alone. A pack variant's is generated whole. */
const CONTRACT_SOURCE_DIRECTORY = /^fixtures\/golden\/(?!pack-)[^/]+\/contract\//;

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

/** Every file the generators write: the golden files of the cases, their OpenAPI documents and the generated part of the scale fixture. */
export function allGeneratedFiles(
  root: string,
  compiler: GoldenCompiler,
  openApi: GoldenOpenApi,
  cases: readonly GoldenCase[] = GOLDEN_CASES,
): GoldenFiles {
  const golden = goldenFiles(root, cases, compiler);
  const documents = goldenOpenApiFiles(golden.files, openApi);

  return {
    files: new Map([
      ...generateScaleFiles(),
      ...packVariantContracts(root),
      ...golden.files,
      ...documents.files,
    ]),
    problems: [...golden.problems, ...documents.problems],
  };
}

/** The pack variant contracts, generated from the reference as it is on disk. */
export function packVariantContracts(root: string): Map<string, string> {
  const reference = new Map(
    filesBelow(root, REFERENCE_DIRECTORY).map((path) => [
      posix.relative(REFERENCE_DIRECTORY, path),
      readFileSync(join(root, path), "utf8"),
    ]),
  );

  return packVariantFiles(reference, GOLDEN_DIRECTORY);
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
    .filter((path) => !files.has(path) && !CONTRACT_SOURCE_DIRECTORY.test(path));
}
