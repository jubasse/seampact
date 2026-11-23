// The per-function coverage of the generator layer (writer, target contract, planning, generate and check) over the
// oracle's CLI cases, cut into port briefs.
//
// Run from the repository root with the compiler's flags:
//   node --experimental-transform-types --no-warnings --import ./scripts/ir-models/register.ts \
//     scripts/rust/generator-coverage.ts
// It writes one table per crate under `docs/maintainers/rust-design/generators/` (the design note
// `docs/maintainers/rust-design/generators.md` says how the briefs read them). A pair is one CLI case run under the
// probe (`tools-pairs.ts`): `generate` and `check` cases are CLI cases.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "../oracle/fixtures.ts";
import { CoverageProbe, coverageTable, cutBriefs, pairsOf } from "./pass-coverage.ts";
import { type ToolCrateSpec, toolSourceFileOf, toolUnitsOf } from "./tools-coverage.ts";
import { collectToolRecords } from "./tools-pairs.ts";

/** Where the tables go; the trace check reads them beside `TOOL_TABLES_DIR` once the generator seam extends it. */
export const GENERATOR_TABLES_DIR = "docs/maintainers/rust-design/generators";

const OUTPUT_DIRECTORY = join(REPO_ROOT, GENERATOR_TABLES_DIR);

const CODEGEN_CORE = "codegen-core/src/";
const CLI = "cli/src/";
const COMMANDS = `${CLI}commands/`;
const CONFIG = `${CLI}config/`;

// The crate split of the design note, section 3; sources in the order a brief takes unreached functions.
export const GENERATOR_CRATES: readonly ToolCrateSpec[] = [
  {
    crate: "paths",
    pairs: "cli",
    sources: [],
    movedIn: [`${CODEGEN_CORE}generated-paths.ts#unsafePathReason`],
  },
  {
    crate: "target",
    pairs: "cli",
    sources: [
      `${CODEGEN_CORE}target.ts`,
      `${CODEGEN_CORE}define-target.ts`,
      `${CODEGEN_CORE}ir-support-refusal.ts`,
      `${CODEGEN_CORE}link-check.ts`,
      `${CODEGEN_CORE}links.ts`,
      `${CODEGEN_CORE}descriptors.ts`,
      `${CODEGEN_CORE}framework-route-check.ts`,
      `${CODEGEN_CORE}import-specifier.ts`,
      `${CODEGEN_CORE}native-docs-document.ts`,
      `${CODEGEN_CORE}generate-warning.ts`,
      `${CODEGEN_CORE}no-options.ts`,
      "spec/src/compatibility/index.ts",
    ],
  },
  {
    crate: "writer",
    pairs: "cli",
    sources: [
      `${CODEGEN_CORE}file-presence.ts`,
      `${CODEGEN_CORE}generated-paths.ts`,
      `${CODEGEN_CORE}manifest.ts`,
      `${CODEGEN_CORE}writer.ts`,
      `${CODEGEN_CORE}finish-files.ts`,
    ],
    skipped: [
      `${CODEGEN_CORE}generated-paths.ts#unsafePathReason`,
      `${CODEGEN_CORE}generated-paths.ts#caseFolded`,
    ],
  },
  {
    crate: "cli-config",
    pairs: "cli",
    sources: [
      `${CONFIG}document-plan.ts`,
      `${CONFIG}artefact-switches.ts`,
      `${CONFIG}package-manager.ts`,
      `${CONFIG}installed-version.ts`,
      `${CONFIG}compatibility-check.ts`,
    ],
    skipped: [
      `${CONFIG}document-plan.ts#openApiApiNames`,
      `${CONFIG}artefact-switches.ts#isFrameworkRouteCheckOff`,
      `${CONFIG}artefact-switches.ts#frameworkRoutesSwitchOf`,
    ],
  },
  {
    crate: "generate",
    pairs: "cli",
    sources: [
      `${COMMANDS}drift-level.ts`,
      `${COMMANDS}run-preparation.ts`,
      `${COMMANDS}app-plan.ts`,
      `${COMMANDS}document-emission.ts`,
      `${COMMANDS}merged-documents.ts`,
      `${COMMANDS}write-plan.ts`,
      `${COMMANDS}write-drift.ts`,
      `${COMMANDS}filter-operations.ts`,
      `${COMMANDS}entry-links.ts`,
      `${COMMANDS}link-set.ts`,
      `${COMMANDS}entry-generation.ts`,
      `${COMMANDS}import-specifier-styles.ts`,
      `${COMMANDS}framework-route-check.ts`,
      `${COMMANDS}framework-docs.ts`,
      `${COMMANDS}exclusive-base-paths.ts`,
      `${COMMANDS}native-docs-document.ts`,
    ],
  },
  {
    crate: "cli",
    pairs: "cli",
    // `runGenerate`, `runCheck` and `pluginRunOf` are ported by the seam (rows of the layer 3.2 `cli` table);
    // `native-entries.ts` and `nativeEntryPolicy` are not ported (the design note, section 1).
    sources: [`${COMMANDS}generate-command.ts`, `${COMMANDS}check-command.ts`],
  },
];

async function main(): Promise<void> {
  const probe = new CoverageProbe(toolSourceFileOf);
  const records = (await collectToolRecords(probe)).cli;

  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

  for (const spec of GENERATOR_CRATES) {
    const units = toolUnitsOf(spec);
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
      `${spec.crate}: ${units.length} functions, ${lines} lines, ${coverage.pairCount} pairs, skeleton about ${coverage.skeletonRustLines} Rust lines, brief lines ${briefLines.join(" ")}, comparable after each brief ${coverage.comparableAfterBrief.join(" ")}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
