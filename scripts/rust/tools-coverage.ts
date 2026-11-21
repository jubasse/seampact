// The per-function coverage of OpenAPI, diff, lint, bundles and the CLI over the oracle cases, cut into port briefs.
//
// Run from the repository root with the compiler's flags:
//   node --experimental-transform-types --no-warnings --import ./scripts/ir-models/register.ts \
//     scripts/rust/tools-coverage.ts
// It writes one table per crate under `docs/maintainers/rust-design/cli-and-tools/` (the design note
// `docs/maintainers/rust-design/cli-and-tools.md` says how the briefs read them). OpenAPI pairs are measured: one per
// (fixture, api) whose expected IR the emitter reads with the default options. A crate whose oracle cases do not exist
// yet has no pair: its table is cut in the order of its `sources`, and cut again once the cases exist.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REPO_ROOT } from "../oracle/fixtures.ts";
import {
  CoverageProbe,
  coverageTable,
  cutBriefs,
  type FunctionUnit,
  pairsOf,
  type ReachedFunction,
} from "./pass-coverage.ts";
import { listTypeScriptFunctionRanges } from "./trace.ts";

const PACKAGES = join(REPO_ROOT, "packages/core");
const EXPECTED_DIRECTORY = join(REPO_ROOT, "fixtures/expected");
const OUTPUT_DIRECTORY = join(REPO_ROOT, "docs/maintainers/rust-design/cli-and-tools");

/** Where a crate's pairs come from: measured OpenAPI emits, or none until the oracle extension writes the cases. */
type PairSource = "openapi" | "pending";

/** One table: a crate and the TypeScript functions it ports. */
export interface ToolCrateSpec {
  crate: string;
  pairs: PairSource;
  /** Files, or directories ending in `/`, under `packages/core/`, in the order a brief takes unreached functions. */
  sources: readonly string[];
  /** `file#function` or `file#*` not ported here: removed, ported in another crate, or waiting for a later layer. */
  skipped?: readonly string[];
}

const CODEGEN_CORE = "codegen-core/src/";
const BUNDLE = "compiler/src/bundle/";
const CLI = "cli/src/";
const COMMANDS = `${CLI}commands/`;
const CONFIG = `${CLI}config/`;

// The crate split of the design note, section 2.
export const TOOL_CRATES: readonly ToolCrateSpec[] = [
  {
    crate: "target",
    pairs: "openapi",
    sources: [
      `${CODEGEN_CORE}refusal.ts`,
      `${CODEGEN_CORE}ir-location.ts`,
      `${CODEGEN_CORE}located-refusals.ts`,
      `${CODEGEN_CORE}unknown-value.ts`,
      `${CODEGEN_CORE}ir-support-refusal.ts`,
      `${CODEGEN_CORE}not-generated-fixes.ts`,
      `${CODEGEN_CORE}generated-paths.ts`,
    ],
    skipped: [`${CODEGEN_CORE}generated-paths.ts#*`],
  },
  { crate: "openapi", pairs: "openapi", sources: ["openapi/src/"] },
  {
    crate: "diff-table",
    pairs: "pending",
    sources: [
      "diff/src/diff-codes.ts",
      "diff/src/result.ts",
      "diff/src/options.ts",
      "diff/src/table/",
    ],
  },
  {
    crate: "diff",
    pairs: "pending",
    sources: [
      "diff/src/diff-contracts.ts",
      "diff/src/walk/walk.ts",
      "diff/src/walk/context.ts",
      "diff/src/walk/sink.ts",
      "diff/src/walk/api.ts",
      "diff/src/walk/operations.ts",
      "diff/src/walk/type-use.ts",
      "diff/src/walk/declarations.ts",
      "diff/src/walk/catalogue.ts",
      "diff/src/walk/access.ts",
      "diff/src/walk/behaviour.ts",
      "diff/src/walk/reach.ts",
      "diff/src/walk/same-wire.ts",
      "diff/src/walk/refusals.ts",
      "diff/src/walk/maturity.ts",
      "diff/src/walk/decimal.ts",
      "diff/src/walk/json.ts",
      "diff/src/gate/",
      "diff/src/deprecation/",
      "diff/src/report/",
    ],
  },
  {
    crate: "lint",
    pairs: "pending",
    sources: [
      "lint/src/run-lint.ts",
      "lint/src/resolve.ts",
      "lint/src/plugin.ts",
      "lint/src/core/",
      "lint/src/describe-error.ts",
      "lint/src/plugin-loader.ts",
    ],
    skipped: [
      "lint/src/plugin-loader.ts#*",
      "lint/src/plugin.ts#defineLintPlugin",
      "lint/src/plugin.ts#isDefinedLintPlugin",
    ],
  },
  {
    crate: "bundle",
    pairs: "pending",
    sources: [
      "spec/src/bundle/",
      `${BUNDLE}contents.ts`,
      `${BUNDLE}integrity.ts`,
      `${BUNDLE}ustar.ts`,
      `${BUNDLE}tarball-write.ts`,
      `${BUNDLE}build.ts`,
      `${BUNDLE}write.ts`,
      `${BUNDLE}untrusted-json.ts`,
      `${BUNDLE}manifest-read.ts`,
      `${BUNDLE}ir-check.ts`,
      `${BUNDLE}tarball-read.ts`,
      `${BUNDLE}verify.ts`,
      `${BUNDLE}local-packages.ts`,
    ],
  },
  {
    crate: "bundle-fetch",
    pairs: "pending",
    sources: [
      `${BUNDLE}fetch.ts`,
      `${BUNDLE}fetch-failure.ts`,
      `${BUNDLE}imports.ts`,
      `${BUNDLE}cache.ts`,
      `${BUNDLE}local-sources.ts`,
      `${BUNDLE}printable-url.ts`,
      `${BUNDLE}fetch-package.ts`,
      `${BUNDLE}fetch-git.ts`,
      `${BUNDLE}fetch-release.ts`,
    ],
  },
  {
    crate: "cli-config",
    pairs: "pending",
    sources: [
      `${CONFIG}config-file.ts`,
      `${CONFIG}config-waits.ts`,
      `${CONFIG}key-path.ts`,
      `${CONFIG}path-containment.ts`,
      `${CONFIG}find-root-config.ts`,
      `${CONFIG}resolved-source.ts`,
      `${CONFIG}maven-source.ts`,
      `${CONFIG}read-app-config.ts`,
      `${CONFIG}read-root-config.ts`,
      `${CONFIG}read-workspace-configs.ts`,
      `${CONFIG}read-run-config.ts`,
      `${CONFIG}artefact-switches.ts`,
      `${CONFIG}document-plan.ts`,
      `${CONFIG}resolve-target.ts`,
      `${CONFIG}compatibility-check.ts`,
      `${CONFIG}installed-version.ts`,
      `${CONFIG}package-manager.ts`,
    ],
    skipped: [
      `${CONFIG}resolve-target.ts#*`,
      `${CONFIG}compatibility-check.ts#*`,
      `${CONFIG}installed-version.ts#*`,
      `${CONFIG}package-manager.ts#*`,
    ],
  },
  { crate: "editor-schemas", pairs: "pending", sources: [`${CLI}editor-schemas/`] },
  {
    crate: "cli",
    pairs: "pending",
    sources: [
      `${CLI}run-cli.ts`,
      `${CLI}cli-io.ts`,
      `${CLI}cli-problem.ts`,
      `${CLI}error-code.ts`,
      `${CLI}is-record.ts`,
      `${CLI}symbolic-link.ts`,
      `${COMMANDS}step.ts`,
      `${COMMANDS}config-location.ts`,
      `${COMMANDS}workspace-api-names.ts`,
      `${COMMANDS}api-refs.ts`,
      `${COMMANDS}local-bundle.ts`,
      `${COMMANDS}compile-sources.ts`,
      `${COMMANDS}compile-command.ts`,
      `${COMMANDS}lint-command.ts`,
      `${COMMANDS}diff-baseline.ts`,
      `${COMMANDS}diff-command.ts`,
      `${COMMANDS}bundle-command.ts`,
      `${COMMANDS}contract-position.ts`,
      `${COMMANDS}explain-view.ts`,
      `${COMMANDS}explain-command.ts`,
      `${COMMANDS}modelines.ts`,
      `${COMMANDS}git-ignore.ts`,
      `${COMMANDS}init-starter.ts`,
      `${COMMANDS}init-command.ts`,
    ],
    skipped: [`${CLI}run-cli.ts#runGenerate`, `${CLI}run-cli.ts#runCheck`],
  },
];

/** The commands and config files of `generate` and `check`, ported with the generator layer. */
export const LATER_LAYER_SOURCES: readonly string[] = [
  `${COMMANDS}app-plan.ts`,
  `${COMMANDS}run-preparation.ts`,
  `${COMMANDS}write-plan.ts`,
  `${COMMANDS}write-drift.ts`,
  `${COMMANDS}drift-level.ts`,
  `${COMMANDS}merged-documents.ts`,
  `${COMMANDS}document-emission.ts`,
  `${COMMANDS}entry-generation.ts`,
  `${COMMANDS}entry-links.ts`,
  `${COMMANDS}link-set.ts`,
  `${COMMANDS}native-entries.ts`,
  `${COMMANDS}native-docs-document.ts`,
  `${COMMANDS}framework-docs.ts`,
  `${COMMANDS}framework-route-check.ts`,
  `${COMMANDS}import-specifier-styles.ts`,
  `${COMMANDS}exclusive-base-paths.ts`,
  `${COMMANDS}filter-operations.ts`,
  `${COMMANDS}generate-command.ts`,
  `${COMMANDS}check-command.ts`,
];

// A path under `packages/core/` with tests and test support left out.
function toolSourceFileOf(path: string): string | undefined {
  if (path.endsWith(".test.ts") || path.endsWith("test-support.ts")) return undefined;

  if (!path.startsWith(`${PACKAGES}/`)) return undefined;

  return relative(PACKAGES, path);
}

function filesUnder(directory: string): string[] {
  const root = join(PACKAGES, directory);

  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((name) => join(root, name))
    .filter((path) => path.endsWith(".ts") && toolSourceFileOf(path) !== undefined)
    .map((path) => relative(PACKAGES, path))
    .sort();
}

function isSkipped(spec: ToolCrateSpec, file: string, name: string): boolean {
  return (spec.skipped ?? []).some((skip) => skip === `${file}#${name}` || skip === `${file}#*`);
}

export function toolUnitsOf(spec: ToolCrateSpec): FunctionUnit[] {
  const files = spec.sources.flatMap((source) =>
    source.endsWith("/") ? filesUnder(source) : [source],
  );
  const units: FunctionUnit[] = [];

  for (const file of files) {
    const path = join(PACKAGES, file);

    for (const found of listTypeScriptFunctionRanges(path, readFileSync(path, "utf8"))) {
      if (isSkipped(spec, file, found.name)) continue;

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

function expectedIrFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((name) => name.split("/").at(-2) === "ir" && name.endsWith(".json"))
    .map((name) => join(directory, name))
    .sort();
}

type EmitDocuments = (ir: unknown) => unknown;

function isEmitDocuments(value: unknown): value is EmitDocuments {
  return typeof value === "function";
}

// One record per (fixture, api): what emitting its documents with the default options reached.
async function openApiRecords(probe: CoverageProbe): Promise<ReachedFunction[][]> {
  const openapi: unknown = await import(pathToFileURL(join(PACKAGES, "openapi/src/index.ts")).href);
  const emitDocuments: unknown = Reflect.get(Object(openapi), "emitDocuments");

  if (!isEmitDocuments(emitDocuments))
    throw new Error("the OpenAPI package exports no emitDocuments");

  const records: ReachedFunction[][] = [];

  for (const file of expectedIrFiles(EXPECTED_DIRECTORY)) {
    probe.take();
    emitDocuments(JSON.parse(readFileSync(file, "utf8")));
    records.push(probe.take());
  }

  return records;
}

async function main(): Promise<void> {
  const probe = new CoverageProbe(toolSourceFileOf);
  const openApi = await openApiRecords(probe);

  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

  for (const spec of TOOL_CRATES) {
    const units = toolUnitsOf(spec);
    const records = spec.pairs === "openapi" ? openApi : [];
    const pairs = pairsOf(units, records).filter((pair) => pair.size > 0);
    const coverage = cutBriefs(units, pairs);
    const lines = units.reduce((sum, unit) => sum + unit.lines, 0);
    const briefCount = Math.max(...coverage.rows.map((row) => row.brief), 0);
    const briefLines = Array.from({ length: briefCount }, (_, index) =>
      coverage.rows
        .filter((row) => row.brief === index + 1)
        .reduce((sum, row) => sum + row.unit.lines, 0),
    );

    writeFileSync(join(OUTPUT_DIRECTORY, `${spec.crate}.tsv`), coverageTable(coverage));
    console.log(
      `${spec.crate}: ${units.length} functions, ${lines} lines, ${coverage.pairCount} pairs, spine ${coverage.spineLines} lines, skeleton about ${coverage.skeletonRustLines} Rust lines, brief lines ${briefLines.join(" ")}, comparable after each brief ${coverage.comparableAfterBrief.join(" ")}`,
    );
  }

  const reachedElsewhere = new Set(
    openApi
      .flat()
      .map((reached) => reached.file)
      .filter((file) => !file.startsWith("openapi/")),
  );

  console.log(`OpenAPI reaches outside its package: ${[...reachedElsewhere].sort().join(" ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
