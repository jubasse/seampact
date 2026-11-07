// Checks a coverage summary against the per-package floors of `scripts/coverage-floors/floors.json`: each CI job that runs a
// language's tests with coverage runs it after them, and it fails naming the package, the metric, the value and the floor.
//
//   node scripts/coverage-floors/check.ts --format vitest --summary coverage/coverage-summary.json
//   node scripts/coverage-floors/check.ts --format coverage-py --summary python/coverage.json
//   node scripts/coverage-floors/check.ts --format cobertura --summary php/hooks/coverage.xml --package php/hooks
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "../golden/repo-root.ts";
import { checkFloors, formatResult, parseFloorsFile } from "./floors.ts";
import {
  type CoverageByPackage,
  CoverageInputError,
  PYTHON_WORKSPACE_DIRECTORY,
  readCoberturaReport,
  readCoveragePyReport,
  readVitestSummary,
  SUMMARY_FORMATS,
  type SummaryFormat,
  TYPESCRIPT_PACKAGES_DIRECTORY,
} from "./summaries.ts";

const FLOORS_PATH = resolve(REPO_ROOT, "scripts/coverage-floors/floors.json");
const EXIT_PASSED = 0;
const EXIT_FAILED = 1;

interface MeasuredSummary {
  coverage: CoverageByPackage;
  // A whole-language run must measure every floored package under this directory.
  expectedPackagesDirectory?: string;
}

function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      format: { type: "string" },
      summary: { type: "string" },
      package: { type: "string" },
      floors: { type: "string" },
    },
  });

  const format = summaryFormatOf(values.format);

  if (values.summary === undefined)
    throw new CoverageInputError("--summary <file> names the coverage summary to check.");

  const summaryPath = resolve(values.summary);
  const floorsPath = resolve(values.floors ?? FLOORS_PATH);
  const floorsFile = parseFloorsFile(readFileSync(floorsPath, "utf8"), floorsPath);
  const measured = readSummary(
    format,
    readFileSync(summaryPath, "utf8"),
    summaryPath,
    values.package,
  );
  const floorCheck = checkFloors(measured.coverage, floorsFile, measured.expectedPackagesDirectory);

  for (const result of floorCheck.results) console.log(formatResult(result));

  if (floorCheck.problems.length === 0) return EXIT_PASSED;

  for (const problem of floorCheck.problems) console.error(problem);

  return EXIT_FAILED;
}

function summaryFormatOf(format: string | undefined): SummaryFormat {
  const knownFormat = SUMMARY_FORMATS.find((summaryFormat) => summaryFormat === format);

  if (knownFormat === undefined)
    throw new CoverageInputError(
      `--format is one of ${SUMMARY_FORMATS.join(", ")}; got ${format ?? "nothing"}.`,
    );

  return knownFormat;
}

function readSummary(
  format: SummaryFormat,
  summaryText: string,
  summaryPath: string,
  packageDirectory: string | undefined,
): MeasuredSummary {
  if (format === "cobertura") {
    if (packageDirectory === undefined)
      throw new CoverageInputError(
        "--package <dir> names the package a Cobertura report measures, e.g. php/hooks.",
      );

    return { coverage: readCoberturaReport(summaryText, summaryPath, packageDirectory) };
  }

  if (packageDirectory !== undefined)
    throw new CoverageInputError(
      `--package applies to a Cobertura report only; a ${format} summary names its packages.`,
    );

  if (format === "vitest")
    return {
      coverage: readVitestSummary(summaryText, summaryPath, REPO_ROOT),
      expectedPackagesDirectory: TYPESCRIPT_PACKAGES_DIRECTORY,
    };

  return {
    coverage: readCoveragePyReport(summaryText, summaryPath),
    expectedPackagesDirectory: PYTHON_WORKSPACE_DIRECTORY,
  };
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof CoverageInputError)) throw error;

  console.error(error.message);
  process.exitCode = EXIT_FAILED;
}
