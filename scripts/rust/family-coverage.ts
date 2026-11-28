// The per-function size of the generator families (layer 3.4), cut into port briefs of about `BRIEF_LINES` lines.
//
// Run from the repository root with the compiler's flags:
//   node --experimental-transform-types --no-warnings --import ./scripts/ir-models/register.ts \
//     scripts/rust/family-coverage.ts
// It writes one table per crate under `docs/maintainers/rust-design/families/` (the design note
// `docs/maintainers/rust-design/families.md` says how the briefs read them) and prints, per crate, its function
// lines, its `throw new Error` sites and its distinct literal refusal codes. No oracle case runs a family yet, so every
// pair count is 0 and a crate is cut in source order; rerun once the family cases exist.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "../oracle/fixtures.ts";
import { coverageTable, cutBriefs, type FunctionUnit } from "./pass-coverage.ts";
import { listTypeScriptFunctionRanges } from "./trace.ts";

/** The root the file column of a family table is relative to. */
export const FAMILY_SOURCES_ROOT = "packages";
/** The per-crate tables of the families. */
export const FAMILY_TABLES_DIR = "docs/maintainers/rust-design/families";

const PACKAGES = join(REPO_ROOT, FAMILY_SOURCES_ROOT);
const CORE = "core/codegen-core/src/";

const THROW_SITE = /throw new Error\(/g;
const LITERAL_CODE = /\bcode:\s*["`]([a-z][a-z0-9.-]*)["`]/g;

export interface FamilyCrateSpec {
  crate: string;
  /** Files, or directories ending in `/`, under `packages/`, in the order a brief takes them. */
  sources: readonly string[];
  /** `file#function` ported elsewhere (another crate or an earlier layer). */
  skipped?: readonly string[];
}

// The crate split of the design note, section 4, in the family order of section 1.
export const FAMILY_CRATES: readonly FamilyCrateSpec[] = [
  {
    crate: "plan",
    sources: [
      `${CORE}client-filled-headers.ts`,
      `${CORE}query-list-wire.ts`,
      `${CORE}not-generated-forms.ts`,
    ],
  },
  {
    crate: "family-typescript",
    sources: [`${CORE}planned-names.ts`, `${CORE}api-index.ts`, `${CORE}property-key.ts`],
  },
  { crate: "gen-ts", sources: ["targets/codegen-ts/src/"] },
  { crate: "family-validators", sources: [`${CORE}validators/`] },
  { crate: "gen-zod", sources: ["targets/codegen-zod/src/"] },
  { crate: "gen-yup", sources: ["targets/codegen-yup/src/"] },
  { crate: "gen-class-validator", sources: ["targets/codegen-class-validator/src/"] },
  {
    crate: "family-node-server",
    sources: [`${CORE}node-server/`, "targets/codegen-hono/src/", "targets/codegen-express/src/"],
  },
  { crate: "gen-fastify", sources: ["targets/codegen-fastify/src/"] },
  { crate: "gen-nestjs", sources: ["targets/codegen-nestjs/src/"] },
  { crate: "gen-nextjs", sources: ["targets/codegen-nextjs/src/"] },
  { crate: "gen-adonis", sources: ["targets/codegen-adonis/src/"] },
  { crate: "gen-msw", sources: ["targets/codegen-msw/src/"] },
  {
    crate: "family-fetch-client",
    sources: [`${CORE}fetch-client/`, "targets/codegen-axios/src/"],
  },
  { crate: "gen-fetch", sources: ["targets/codegen-fetch/src/"] },
  { crate: "family-front-queries", sources: [`${CORE}front-queries/`] },
  { crate: "gen-react", sources: ["targets/codegen-react/src/"] },
  { crate: "gen-vue", sources: ["targets/codegen-vue/src/"] },
  { crate: "gen-angular", sources: ["targets/codegen-angular/src/"] },
];

/** A family written in PHP, Python or Kotlin: no TypeScript function ranges, so its table lists files. */
export interface NativeFamilySpec {
  crate: string;
  /** Source directories, relative to the repository root. */
  directories: readonly string[];
  extension: string;
}

// The code-model phase of the design note, section 1, in its order.
export const NATIVE_FAMILIES: readonly NativeFamilySpec[] = [
  { crate: "family-php", directories: ["php/codegen/src"], extension: ".php" },
  { crate: "gen-laravel", directories: ["php/laravel/src"], extension: ".php" },
  { crate: "gen-symfony", directories: ["php/symfony/src"], extension: ".php" },
  { crate: "gen-api-platform", directories: ["php/api-platform/src"], extension: ".php" },
  { crate: "family-python", directories: ["python/codegen/src"], extension: ".py" },
  { crate: "gen-fastapi", directories: ["python/fastapi/src"], extension: ".py" },
  { crate: "family-django", directories: ["python/django/src"], extension: ".py" },
  { crate: "gen-drf", directories: ["python/drf/src"], extension: ".py" },
  { crate: "gen-ninja", directories: ["python/ninja/src"], extension: ".py" },
  {
    crate: "gen-spring-boot",
    directories: ["jvm/seampact-spring-boot/src/main"],
    extension: ".kt",
  },
];

const NATIVE_TABLE = "native.tsv";
// A runtime package the generated code imports stays in its language, and a native CLI entry point is a launcher
// (layer 3.5); only the generator is ported.
const NOT_GENERATOR_PATHS = [
  "/runtime/",
  "GenerateCommand.php",
  "SeampactCommandsProvider.php",
  "/management/commands/",
];

function isGeneratorFile(name: string, extension: string): boolean {
  const path = `/${name}`;

  return path.endsWith(extension) && !NOT_GENERATOR_PATHS.some((part) => path.includes(part));
}

function nativeTable(): string {
  const rows = ["crate\tfile\tlines"];

  for (const family of NATIVE_FAMILIES) {
    let familyLines = 0;

    for (const directory of family.directories) {
      const root = join(REPO_ROOT, directory);
      const files = readdirSync(root, { recursive: true, encoding: "utf8" })
        .filter((name) => isGeneratorFile(name, family.extension))
        .sort();

      for (const name of files) {
        const text = readFileSync(join(root, name), "utf8");
        const lines = text.split("\n").filter((line) => line.trim() !== "").length;

        familyLines += lines;
        rows.push([family.crate, join(directory, name), lines].join("\t"));
      }
    }

    console.log(`${family.crate}: ${familyLines} non-blank lines`);
  }

  return `${rows.join("\n")}\n`;
}

function isPortedSource(path: string): boolean {
  return (
    path.endsWith(".ts") &&
    !path.endsWith(".test.ts") &&
    !path.endsWith("test-support.ts") &&
    !path.endsWith(".d.ts")
  );
}

function filesOf(source: string): string[] {
  if (!source.endsWith("/")) return [source];

  const root = join(PACKAGES, source);

  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((name) => join(root, name))
    .filter(isPortedSource)
    .map((path) => relative(PACKAGES, path))
    .sort();
}

export function familyFilesOf(spec: FamilyCrateSpec): string[] {
  return spec.sources.flatMap(filesOf);
}

export function familyUnitsOf(spec: FamilyCrateSpec): FunctionUnit[] {
  const units: FunctionUnit[] = [];

  for (const file of familyFilesOf(spec)) {
    const path = join(PACKAGES, file);

    for (const found of listTypeScriptFunctionRanges(path, readFileSync(path, "utf8"))) {
      if ((spec.skipped ?? []).includes(`${file}#${found.name}`)) continue;

      units.push({
        id: units.length,
        file,
        name: found.name,
        startLine: found.startLine,
        endLine: found.endLine,
        lines: found.endLine - found.startLine + 1,
      });
    }
  }

  return units;
}

/** The `throw new Error` sites and the distinct literal `code:` strings of a crate's files. */
export function familyFaultsOf(spec: FamilyCrateSpec): { throws: number; codes: Set<string> } {
  let throws = 0;
  const codes = new Set<string>();

  for (const file of familyFilesOf(spec)) {
    const text = readFileSync(join(PACKAGES, file), "utf8");

    throws += [...text.matchAll(THROW_SITE)].length;

    for (const match of text.matchAll(LITERAL_CODE))
      if (match[1] !== undefined) codes.add(match[1]);
  }

  return { throws, codes };
}

function main(): void {
  const outputDirectory = join(REPO_ROOT, FAMILY_TABLES_DIR);
  const everyCode = new Set<string>();
  let everyThrow = 0;

  mkdirSync(outputDirectory, { recursive: true });

  for (const spec of FAMILY_CRATES) {
    const units = familyUnitsOf(spec);
    const coverage = cutBriefs(units, []);
    const lines = units.reduce((sum, unit) => sum + unit.lines, 0);
    const briefCount = Math.max(...coverage.rows.map((row) => row.brief), 0);
    const briefLines = Array.from({ length: briefCount }, (_, index) =>
      coverage.rows
        .filter((row) => row.brief === index + 1)
        .reduce((sum, row) => sum + row.unit.lines, 0),
    );
    const faults = familyFaultsOf(spec);

    everyThrow += faults.throws;

    for (const code of faults.codes) everyCode.add(code);

    writeFileSync(join(outputDirectory, `${spec.crate}.tsv`), coverageTable(coverage));
    console.log(
      `${spec.crate}: ${units.length} functions, ${lines} lines, briefs ${briefLines.join(" ")}, throws ${faults.throws}, codes ${faults.codes.size}`,
    );
  }

  console.log(`all: throws ${everyThrow}, distinct codes ${everyCode.size}`);
  writeFileSync(join(outputDirectory, NATIVE_TABLE), nativeTable());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
