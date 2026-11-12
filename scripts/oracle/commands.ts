import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { firstMismatch, type Mismatch, printMismatch } from "./compare.ts";
import { loadOracleCompiler } from "./compiler.ts";
import { expectedFilesOf, readExpectedFiles, writeExpectedFiles } from "./expected.ts";
import {
  discoverFixtures,
  EXPECTED_ROOT,
  fixtureMatcher,
  type OracleFixture,
  readExcluded,
} from "./fixtures.ts";
import { declaredRuleIds } from "./rule-ids.ts";

export const RULE_COVERAGE_FILE = join(EXPECTED_ROOT, "rule-coverage.json");

const JSON_INDENT = 2;

/** The fixtures a command works on: discovered, not excluded, matching the glob. */
export function selectedFixtures(glob: string | undefined): OracleFixture[] {
  const excluded = readExcluded().fixtures;
  const matches = fixtureMatcher(glob);

  return discoverFixtures().filter(({ path }) => excluded[path] === undefined && matches(path));
}

/** Compiles the selected fixtures and writes their expected outputs. */
export async function writeCommand(glob: string | undefined): Promise<string> {
  const compiler = await loadOracleCompiler();
  const excluded = readExcluded();
  const fixtures = selectedFixtures(glob);

  for (const fixture of fixtures)
    writeExpectedFiles(fixture, expectedFilesOf(compiler, fixture, excluded));

  return `oracle: wrote ${fixtures.length} fixtures`;
}

export interface CheckResult {
  fixtures: number;
  matching: number;
  differing: number;
  /** The first mismatch only, with the fixture it belongs to. */
  first?: { fixture: string; mismatch: Mismatch };
}

/** Compiles the selected fixtures and compares them with their expected outputs. */
export async function checkFixtures(glob: string | undefined): Promise<CheckResult> {
  const compiler = await loadOracleCompiler();
  const excluded = readExcluded();
  const result: CheckResult = { fixtures: 0, matching: 0, differing: 0 };

  for (const fixture of selectedFixtures(glob)) {
    const mismatch = firstMismatch(
      readExpectedFiles(fixture),
      expectedFilesOf(compiler, fixture, excluded),
    );

    result.fixtures++;

    if (mismatch === undefined) {
      result.matching++;
      continue;
    }

    result.differing++;
    result.first ??= { fixture: fixture.path, mismatch };
  }

  return result;
}

export function checkReport(result: CheckResult): string {
  const counts = `oracle: ${result.fixtures} fixtures, ${result.matching} match, ${result.differing} differ`;

  return result.first === undefined
    ? counts
    : `${counts}\n${printMismatch(result.first.fixture, result.first.mismatch)}`;
}

/** The fixtures whose expected diagnostics hold each rule id, per declared rule id. */
export function ruleCoverage(): Record<string, string[]> {
  const coverage: Record<string, string[]> = Object.fromEntries(
    declaredRuleIds().map((id) => [id, []]),
  );

  for (const fixture of selectedFixtures(undefined)) {
    const text = readExpectedFiles(fixture).get("diagnostics.json");

    if (text === undefined) continue;

    for (const id of Object.keys(coverage))
      if (text.includes(`"rule": "${id}"`)) coverage[id]?.push(fixture.path);
  }

  return coverage;
}

/** Writes `rule-coverage.json` and lists the uncovered rule ids. */
export function coverageCommand(): string {
  const coverage = ruleCoverage();
  const uncovered = Object.keys(coverage).filter((id) => coverage[id]?.length === 0);

  mkdirSync(EXPECTED_ROOT, { recursive: true });
  writeFileSync(RULE_COVERAGE_FILE, `${JSON.stringify(coverage, null, JSON_INDENT)}\n`);

  return [
    `oracle: ${Object.keys(coverage).length} rules, ${uncovered.length} uncovered`,
    ...uncovered.map((id) => `  ${id}`),
  ].join("\n");
}
