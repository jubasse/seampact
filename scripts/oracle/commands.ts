import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { firstMismatch, type Mismatch, printMismatch } from "./compare.ts";
import { loadOracleCompiler } from "./compiler.ts";
import {
  expectedFilesOf,
  expectedFixturePaths,
  readExpectedFiles,
  writeExpectedFiles,
} from "./expected.ts";
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
  /** Whole-tree problems: expected outputs of no fixture, `excluded.json` keys naming no fixture. */
  problems: string[];
  /** The first mismatch only, with the fixture it belongs to. */
  first?: { fixture: string; mismatch: Mismatch };
}

function treeProblems(): string[] {
  const known = new Set(discoverFixtures().map(({ path }) => path));
  const excluded = readExcluded();
  const kept = new Set(Object.keys(excluded.fixtures));
  const problems = expectedFixturePaths()
    .filter((path) => !known.has(path) || kept.has(path))
    .map((path) => `expected/${path} belongs to no compiled fixture: delete it`);

  for (const [list, keys] of Object.entries(excluded))
    for (const path of Object.keys(keys))
      if (!known.has(path)) problems.push(`excluded.json ${list}: '${path}' names no fixture`);

  return problems;
}

/** Compiles the selected fixtures and compares them with their expected outputs; a whole run also checks the tree. */
export async function checkFixtures(glob: string | undefined): Promise<CheckResult> {
  const compiler = await loadOracleCompiler();
  const excluded = readExcluded();
  const result: CheckResult = {
    fixtures: 0,
    matching: 0,
    differing: 0,
    problems: glob === undefined ? treeProblems() : [],
  };

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

  const first =
    result.first === undefined ? [] : [printMismatch(result.first.fixture, result.first.mismatch)];

  return [counts, ...result.problems.map((problem) => `oracle: ${problem}`), ...first].join("\n");
}

const EMITTED_RULE = /"rule": "(seampact\/[^"]+)"/g;

export interface RuleCoverage {
  /** The fixtures whose expected diagnostics hold each declared rule id; empty when uncovered. */
  coverage: Record<string, string[]>;
  /** Rule ids the expected diagnostics hold that no compiler source declares. */
  undeclared: string[];
}

/** The fixtures whose expected diagnostics hold each declared rule id, and the emitted ids no source declares. */
export function ruleCoverage(declared: readonly string[] = declaredRuleIds()): RuleCoverage {
  const coverage: Record<string, string[]> = Object.fromEntries(declared.map((id) => [id, []]));
  const undeclared = new Set<string>();

  for (const fixture of selectedFixtures(undefined)) {
    const text = readExpectedFiles(fixture).get("diagnostics.json");

    if (text === undefined) continue;

    for (const [, id = ""] of text.matchAll(EMITTED_RULE)) {
      const fixtures = coverage[id];

      if (fixtures === undefined) undeclared.add(id);
      else if (!fixtures.includes(fixture.path)) fixtures.push(fixture.path);
    }
  }

  return { coverage, undeclared: [...undeclared].sort() };
}

export interface CoverageResult {
  report: string;
  ok: boolean;
}

/** Writes `rule-coverage.json`, lists the uncovered rule ids and fails on an emitted id no source declares. */
export function coverageCommand(): CoverageResult {
  const { coverage, undeclared } = ruleCoverage();
  const uncovered = Object.keys(coverage).filter((id) => coverage[id]?.length === 0);

  mkdirSync(EXPECTED_ROOT, { recursive: true });
  writeFileSync(RULE_COVERAGE_FILE, `${JSON.stringify(coverage, null, JSON_INDENT)}\n`);

  const lines = [
    `oracle: ${Object.keys(coverage).length} rules, ${uncovered.length} uncovered`,
    ...uncovered.map((id) => `  ${id}`),
  ];

  if (undeclared.length > 0)
    lines.push(
      `oracle: ${undeclared.length} emitted rule ids no compiler source declares (add them to rule-ids.ts forms):`,
      ...undeclared.map((id) => `  ${id}`),
    );

  return { report: lines.join("\n"), ok: undeclared.length === 0 };
}
