import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../golden/repo-root.ts";
import { checkFloors, type FloorsFile, parseFloorsFile } from "./floors.ts";
import {
  CoverageInputError,
  readCoberturaReport,
  readCoveragePyReport,
  readVitestSummary,
} from "./summaries.ts";

const CHECK_SCRIPT = join(REPO_ROOT, "scripts/coverage-floors/check.ts");
const FLOORS_PATH = join(REPO_ROOT, "scripts/coverage-floors/floors.json");

function floorsOf(
  packages: Record<string, { lines: number; branches?: number }>,
  notMeasured: Record<string, string> = {},
): FloorsFile {
  return parseFloorsFile(JSON.stringify({ packages, notMeasured }), "floors.json");
}

function vitestSummary(
  files: Record<string, { lines: [number, number]; branches: [number, number] }>,
): string {
  const entries = Object.entries(files).map(([file, { lines, branches }]) => [
    join(REPO_ROOT, file),
    {
      lines: { covered: lines[0], total: lines[1] },
      branches: { covered: branches[0], total: branches[1] },
    },
  ]);

  return JSON.stringify({ total: {}, ...Object.fromEntries(entries) });
}

describe("the coverage summaries", () => {
  it("sums a vitest summary's files into their package", () => {
    const summary = vitestSummary({
      "packages/core/cli/src/a.ts": { lines: [8, 10], branches: [1, 2] },
      "packages/core/cli/src/deep/b.ts": { lines: [2, 10], branches: [1, 2] },
      "packages/core/lint/src/c.ts": { lines: [5, 5], branches: [0, 0] },
    });

    const coverage = readVitestSummary(summary, "coverage-summary.json", REPO_ROOT);

    expect(coverage).toEqual(
      new Map([
        [
          "packages/core/cli",
          { lines: { covered: 10, total: 20 }, branches: { covered: 2, total: 4 } },
        ],
        [
          "packages/core/lint",
          { lines: { covered: 5, total: 5 }, branches: { covered: 0, total: 0 } },
        ],
      ]),
    );
  });

  it("sums a coverage.py report's statements and branches into its workspace member", () => {
    const report = JSON.stringify({
      files: {
        "ir/src/seampact/ir/a.py": {
          summary: { covered_lines: 9, num_statements: 10, covered_branches: 3, num_branches: 4 },
        },
        "ir/src/seampact/ir/b.py": {
          summary: { covered_lines: 1, num_statements: 10, covered_branches: 1, num_branches: 4 },
        },
      },
    });

    expect(readCoveragePyReport(report, "coverage.json")).toEqual(
      new Map([
        ["python/ir", { lines: { covered: 10, total: 20 }, branches: { covered: 4, total: 8 } }],
      ]),
    );
  });

  it("reads a Cobertura report's totals, without branches when the tool counts none", () => {
    const report =
      '<?xml version="1.0"?><coverage line-rate="0.5" lines-covered="43" lines-valid="61" branches-covered="0" branches-valid="0">';

    expect(readCoberturaReport(report, "coverage.xml", "php/hooks")).toEqual(
      new Map([["php/hooks", { lines: { covered: 43, total: 61 } }]]),
    );
  });

  it("refuses a summary without the counts its format states, naming the field", () => {
    const summary = JSON.stringify({
      [join(REPO_ROOT, "packages/core/cli/src/a.ts")]: { lines: { covered: 1 } },
    });

    expect(() => readVitestSummary(summary, "coverage-summary.json", REPO_ROOT)).toThrow(
      CoverageInputError,
    );
    expect(() => readVitestSummary(summary, "coverage-summary.json", REPO_ROOT)).toThrow(
      /a\.ts\.lines\.total: expected a count/u,
    );
    expect(() => readCoberturaReport("<report/>", "coverage.xml", "php/hooks")).toThrow(
      /no <coverage> element/u,
    );
  });
});

describe("the floors check", () => {
  const measured = new Map([
    [
      "packages/core/cli",
      { lines: { covered: 90, total: 100 }, branches: { covered: 3, total: 4 } },
    ],
  ]);

  it("passes a package at or above each of its floors", () => {
    const floorCheck = checkFloors(
      measured,
      floorsOf({ "packages/core/cli": { lines: 90, branches: 75 } }),
      "packages",
    );

    expect(floorCheck.problems).toEqual([]);
    expect(floorCheck.results.map(({ metric, percent }) => [metric, percent])).toEqual([
      ["lines", 90],
      ["branches", 75],
    ]);
  });

  it("fails a package under a floor, naming the package, the metric, the value and the floor", () => {
    const floorCheck = checkFloors(
      measured,
      floorsOf({ "packages/core/cli": { lines: 91, branches: 75 } }),
    );

    expect(floorCheck.problems).toEqual([
      expect.stringMatching(
        /^packages\/core\/cli: lines coverage 90\.00% is under its floor of 91%; /u,
      ),
    ]);
  });

  it("fails a measured package without a floor, and one listed as not measured", () => {
    expect(checkFloors(measured, floorsOf({})).problems).toEqual([
      expect.stringMatching(/^packages\/core\/cli has no floor; /u),
    ]);
    expect(
      checkFloors(measured, floorsOf({}, { "packages/core/cli": "no tests" })).problems,
    ).toEqual([
      expect.stringMatching(/^packages\/core\/cli is measured but listed under notMeasured/u),
    ]);
  });

  it("fails a floored package of a whole-language run that the summary does not measure", () => {
    const floors = floorsOf({
      "packages/core/cli": { lines: 90 },
      "packages/core/lint": { lines: 90 },
      "python/ir": { lines: 90 },
    });

    expect(checkFloors(measured, floors, "packages").problems).toEqual([
      expect.stringMatching(/^packages\/core\/lint has a floor but the summary measured none/u),
    ]);
    expect(checkFloors(measured, floors).problems).toEqual([]);
  });

  it("fails a floored package whose summary counts no line, in every format, unless it is not measured", () => {
    const emptyCobertura = readCoberturaReport(
      '<coverage lines-covered="0" lines-valid="0" branches-covered="0" branches-valid="0">',
      "coverage.xml",
      "php/hooks",
    );
    const emptyVitest = readVitestSummary(
      vitestSummary({ "packages/core/cli/src/a.ts": { lines: [0, 0], branches: [0, 0] } }),
      "coverage-summary.json",
      REPO_ROOT,
    );
    const emptyCoveragePy = readCoveragePyReport(
      JSON.stringify({
        files: { "ir/src/seampact/ir/a.py": { summary: { covered_lines: 0, num_statements: 0 } } },
      }),
      "coverage.json",
    );
    const floors = floorsOf({
      "php/hooks": { lines: 90 },
      "packages/core/cli": { lines: 90 },
      "python/ir": { lines: 90 },
    });

    for (const emptySummary of [emptyCobertura, emptyVitest, emptyCoveragePy]) {
      expect(checkFloors(emptySummary, floors).problems).toEqual([
        expect.stringMatching(/: the summary counts no lines, so nothing was measured/u),
      ]);
    }

    // A not-measured package that still shows up with no counted line, like a types-only package, passes.
    const notMeasuredFloors = floorsOf({}, { "php/hooks": "No source." });

    expect(checkFloors(emptyCobertura, notMeasuredFloors).problems).toEqual([]);
  });

  it("fails a branch floor when the tool counts no branches", () => {
    const linesOnly = new Map([["php/hooks", { lines: { covered: 1, total: 1 } }]]);

    expect(
      checkFloors(linesOnly, floorsOf({ "php/hooks": { lines: 90, branches: 50 } })).problems,
    ).toEqual([expect.stringMatching(/^php\/hooks: the summary has no branches counts/u)]);
  });

  it("refuses a floor that is not a whole percentage, or an unknown metric", () => {
    expect(() => floorsOf({ "php/hooks": { lines: 90.5 } })).toThrow(
      /packages\.php\/hooks\.lines: a floor is a whole percentage/u,
    );
    expect(() =>
      parseFloorsFile(
        '{"packages":{"php/hooks":{"lines":90,"statements":80}},"notMeasured":{}}',
        "floors.json",
      ),
    ).toThrow(/unknown key statements/u);
  });

  it("reads the committed floors file", () => {
    const floorsFile = parseFloorsFile(readFileSync(FLOORS_PATH, "utf8"), FLOORS_PATH);

    expect(floorsFile.packages.size).toBeGreaterThan(0);
  });
});

describe("the coverage check command", () => {
  let workDirectory: string | undefined;

  afterEach(() => {
    if (workDirectory !== undefined) rmSync(workDirectory, { recursive: true, force: true });
    workDirectory = undefined;
  });

  function runCheck(
    floors: object,
    report: string,
  ): { status: number | null; stdout: string; stderr: string } {
    workDirectory = mkdtempSync(join(tmpdir(), "coverage-check-"));
    const floorsPath = join(workDirectory, "floors.json");
    const reportPath = join(workDirectory, "coverage.xml");

    writeFileSync(floorsPath, JSON.stringify(floors));
    writeFileSync(reportPath, report);

    const result = spawnSync(
      process.execPath,
      [
        CHECK_SCRIPT,
        "--format",
        "cobertura",
        "--summary",
        reportPath,
        "--package",
        "php/hooks",
        "--floors",
        floorsPath,
      ],
      {
        encoding: "utf8",
      },
    );

    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  const report =
    '<coverage lines-covered="70" lines-valid="100" branches-covered="0" branches-valid="0">';

  it("prints each metric with its floor and exits 0 at or above the floors", () => {
    const result = runCheck({ packages: { "php/hooks": { lines: 70 } }, notMeasured: {} }, report);

    expect(result).toMatchObject({
      status: 0,
      stdout: "php/hooks lines 70.00% (floor 70%)\n",
      stderr: "",
    });
  });

  it("exits 1 naming the package, the metric, the value and the floor under a floor", () => {
    const result = runCheck({ packages: { "php/hooks": { lines: 71 } }, notMeasured: {} }, report);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /^php\/hooks: lines coverage 70\.00% is under its floor of 71%; /u,
    );
  });

  it("exits 1 on a report that counts no line, which would otherwise read as fully covered", () => {
    const result = runCheck(
      { packages: { "php/hooks": { lines: 70 } }, notMeasured: {} },
      '<coverage lines-covered="0" lines-valid="0" branches-covered="0" branches-valid="0">',
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^php\/hooks: the summary counts no lines/u);
  });
});
