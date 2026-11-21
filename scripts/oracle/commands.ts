import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { firstMismatch, type Mismatch, printMismatch } from "./compare.ts";
import {
  expectedFilesOf,
  loadOracleContext,
  type OracleContext,
  readExpectedFiles,
  unclaimedExpectedDirectories,
  writeExpectedFiles,
} from "./expected.ts";
import { EXPECTED_ROOT, fixtureMatcher, readExcluded } from "./fixtures.ts";
import { declaredRuleIds } from "./rule-ids.ts";
import { discoverTargets, type OracleTarget } from "./targets.ts";
import { DIFF_TABLE_FILE, diffTableText } from "./tool-diff.ts";

export const RULE_COVERAGE_FILE = join(EXPECTED_ROOT, "rule-coverage.json");

const JSON_INDENT = 2;
const DIFF_TABLE_CASE = "diff-table";
const DIFF_TABLE_PATH = join(EXPECTED_ROOT, DIFF_TABLE_FILE);

/** Every target not excluded, a fixture the oracle cannot compile alone leaving only its tool case, if any. */
function discoveredTargets(): OracleTarget[] {
  const excluded = readExcluded().fixtures;

  return discoverTargets().flatMap((target) => {
    if (target.fixture === undefined || excluded[target.path] === undefined) return [target];

    return target.tool === undefined
      ? []
      : [{ path: target.path, directory: target.directory, tool: target.tool }];
  });
}

/** The targets a command works on: discovered, not excluded, matching the glob. */
export function selectedTargets(glob: string | undefined): OracleTarget[] {
  const matches = fixtureMatcher(glob);

  return discoveredTargets().filter(({ path }) => matches(path));
}

/** Whether the glob selects the global `diff-table.json` case. */
export const selectsDiffTable = (glob: string | undefined): boolean =>
  fixtureMatcher(glob)(DIFF_TABLE_CASE);

/** Whether the glob selects anything: a target or the global case. */
export const selectsAnything = (glob: string | undefined): boolean =>
  selectedTargets(glob).length > 0 || (glob !== undefined && selectsDiffTable(glob));

/** Runs the selected targets and writes their expected outputs. */
export async function writeCommand(glob: string | undefined): Promise<string> {
  const context = await loadOracleContext();
  const excluded = readExcluded();
  const targets = selectedTargets(glob);

  for (const target of targets)
    writeExpectedFiles(target, await expectedFilesOf(context, target, excluded));

  if (selectsDiffTable(glob)) writeFileSync(DIFF_TABLE_PATH, diffTableText(context.tools));

  return `oracle: wrote ${targets.length} cases`;
}

export interface CheckResult {
  /** The cases checked: fixtures and tool cases. */
  fixtures: number;
  matching: number;
  differing: number;
  /** Whole-tree problems: expected outputs of no fixture, `excluded.json` keys naming no fixture. */
  problems: string[];
  /** The first mismatch only, with the fixture it belongs to. */
  first?: { fixture: string; mismatch: Mismatch };
}

function treeProblems(): string[] {
  const known = new Set(discoveredTargets().map(({ path }) => path));
  const excluded = readExcluded();
  const discovered = new Set(discoverTargets().map(({ path }) => path));
  const problems = unclaimedExpectedDirectories(known).map(
    (path) => `expected/${path} belongs to no case: delete it`,
  );

  for (const [list, keys] of Object.entries(excluded))
    for (const path of Object.keys(keys))
      if (!discovered.has(path)) problems.push(`excluded.json ${list}: '${path}' names no fixture`);

  return problems;
}

function diffTableMismatch(context: OracleContext): Mismatch | undefined {
  const expected = existsSync(DIFF_TABLE_PATH)
    ? new Map([[DIFF_TABLE_FILE, readFileSync(DIFF_TABLE_PATH, "utf8")]])
    : new Map<string, string>();

  return firstMismatch(expected, new Map([[DIFF_TABLE_FILE, diffTableText(context.tools)]]));
}

/** Runs the selected targets and compares them with their expected outputs; a whole run also checks the tree. */
export async function checkFixtures(glob: string | undefined): Promise<CheckResult> {
  const context = await loadOracleContext();
  const excluded = readExcluded();
  const result: CheckResult = {
    fixtures: 0,
    matching: 0,
    differing: 0,
    problems: glob === undefined ? treeProblems() : [],
  };

  for (const target of selectedTargets(glob)) {
    const mismatch = firstMismatch(
      readExpectedFiles(target),
      await expectedFilesOf(context, target, excluded),
    );

    result.fixtures++;

    if (mismatch === undefined) {
      result.matching++;
      continue;
    }

    result.differing++;
    result.first ??= { fixture: target.path, mismatch };
  }

  if (selectsDiffTable(glob)) {
    const mismatch = diffTableMismatch(context);

    result.fixtures++;

    if (mismatch === undefined) result.matching++;
    else {
      result.differing++;
      result.first ??= { fixture: DIFF_TABLE_CASE, mismatch };
    }
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

  for (const fixture of selectedTargets(undefined)) {
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
