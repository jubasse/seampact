import { isAbsolute, relative, resolve } from "node:path";

/** Covered and total counts of one metric: lines (statements for coverage.py) or branches. */
export interface Counts {
  covered: number;
  total: number;
}

/** What a coverage tool measured in one package; `branches` is absent when the tool counts no branches (pcov). */
export interface PackageCoverage {
  lines: Counts;
  branches?: Counts;
}

/** The coverage of each package, keyed by its repository-relative directory, as the floors file keys it. */
export type CoverageByPackage = Map<string, PackageCoverage>;

/**
 * The summary formats the checker reads: vitest's `json-summary`, coverage.py's `json` report, and the Cobertura XML
 * that PHPUnit writes for one package. JaCoCo's floors are checked by the JVM build itself (`-PseampactCoverage`).
 */
export const SUMMARY_FORMATS = ["vitest", "coverage-py", "cobertura"] as const;
export type SummaryFormat = (typeof SUMMARY_FORMATS)[number];

/** The TypeScript packages, `packages/<group>/<name>`, that the vitest summary's files belong to. */
export const TYPESCRIPT_PACKAGES_DIRECTORY = "packages";
const TYPESCRIPT_PACKAGE_DEPTH = 3;

/** The uv workspace whose members, `python/<member>`, the coverage.py report's paths start from. */
export const PYTHON_WORKSPACE_DIRECTORY = "python";
const PYTHON_PACKAGE_DEPTH = 2;

const VITEST_TOTAL_KEY = "total";
const PERCENT = 100;

/** Thrown when a summary or the floors file does not have its stated shape; the message names the file and the field. */
export class CoverageInputError extends Error {}

/** The percentage of `counts`; nothing to cover is fully covered. */
export function percentOf(counts: Counts): number {
  if (counts.total === 0) return PERCENT;

  return (counts.covered / counts.total) * PERCENT;
}

/**
 * Reads vitest's `coverage-summary.json`: one entry per file, keyed by absolute path, summed into its package.
 * `repositoryRoot` turns the paths into the floors file's keys.
 */
export function readVitestSummary(
  summaryText: string,
  summaryName: string,
  repositoryRoot: string,
): CoverageByPackage {
  const summary = parseJsonObject(summaryText, summaryName);
  const coverageByPackage: CoverageByPackage = new Map();

  for (const [filePath, fileSummary] of Object.entries(summary)) {
    if (filePath === VITEST_TOTAL_KEY) continue;

    const packageDirectory = packageDirectoryOf(
      repositoryRelativePath(filePath, repositoryRoot),
      TYPESCRIPT_PACKAGE_DEPTH,
    );
    const metrics = asJsonObject(fileSummary, `${summaryName}: ${filePath}`);

    addCoverage(coverageByPackage, packageDirectory, {
      lines: vitestCounts(metrics.lines, `${summaryName}: ${filePath}.lines`),
      branches: vitestCounts(metrics.branches, `${summaryName}: ${filePath}.branches`),
    });
  }

  return coverageByPackage;
}

/**
 * Reads coverage.py's JSON report of a run from the uv workspace: each file's statements and branches, summed into
 * its member. The report's paths start from `python/`.
 */
export function readCoveragePyReport(reportText: string, reportName: string): CoverageByPackage {
  const report = parseJsonObject(reportText, reportName);
  const files = asJsonObject(report.files, `${reportName}: files`);
  const coverageByPackage: CoverageByPackage = new Map();

  for (const [filePath, fileReport] of Object.entries(files)) {
    const packageDirectory = packageDirectoryOf(
      `${PYTHON_WORKSPACE_DIRECTORY}/${filePath}`,
      PYTHON_PACKAGE_DEPTH,
    );
    const fileCoverage = coveragePyFileCoverage(
      asJsonObject(fileReport, `${reportName}: ${filePath}`).summary,
      `${reportName}: ${filePath}.summary`,
    );

    addCoverage(coverageByPackage, packageDirectory, fileCoverage);
  }

  return coverageByPackage;
}

/**
 * Reads the totals of a Cobertura report, all of whose files are one package's (`--coverage-cobertura` of PHPUnit).
 * A report that counts no branches, as pcov's, has no branch metric.
 */
export function readCoberturaReport(
  reportText: string,
  reportName: string,
  packageDirectory: string,
): CoverageByPackage {
  const rootTag = /<coverage\s[^>]*>/u.exec(reportText)?.[0];

  if (rootTag === undefined)
    throw new CoverageInputError(`${reportName}: no <coverage> element; is it a Cobertura report?`);

  const lines = {
    covered: coberturaCount(rootTag, "lines-covered", reportName),
    total: coberturaCount(rootTag, "lines-valid", reportName),
  };
  const branches = {
    covered: coberturaCount(rootTag, "branches-covered", reportName),
    total: coberturaCount(rootTag, "branches-valid", reportName),
  };

  return new Map([[packageDirectory, branches.total === 0 ? { lines } : { lines, branches }]]);
}

function repositoryRelativePath(filePath: string, repositoryRoot: string): string {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(repositoryRoot, filePath);

  return relative(repositoryRoot, absolutePath).split("\\").join("/");
}

function packageDirectoryOf(repositoryPath: string, packageDepth: number): string {
  const segments = repositoryPath.split("/");

  if (segments.length <= packageDepth)
    throw new CoverageInputError(
      `${repositoryPath} is not inside a package directory ${packageDepth} levels deep.`,
    );

  return segments.slice(0, packageDepth).join("/");
}

function addCoverage(
  coverageByPackage: CoverageByPackage,
  packageDirectory: string,
  fileCoverage: PackageCoverage,
): void {
  const packageCoverage = coverageByPackage.get(packageDirectory);

  if (packageCoverage === undefined) {
    coverageByPackage.set(packageDirectory, {
      lines: { ...fileCoverage.lines },
      ...(fileCoverage.branches === undefined ? {} : { branches: { ...fileCoverage.branches } }),
    });

    return;
  }

  addCounts(packageCoverage.lines, fileCoverage.lines);

  if (fileCoverage.branches === undefined) return;

  packageCoverage.branches ??= { covered: 0, total: 0 };
  addCounts(packageCoverage.branches, fileCoverage.branches);
}

function addCounts(sum: Counts, counts: Counts): void {
  sum.covered += counts.covered;
  sum.total += counts.total;
}

function vitestCounts(metric: unknown, name: string): Counts {
  const counts = asJsonObject(metric, name);

  return {
    covered: asCount(counts.covered, `${name}.covered`),
    total: asCount(counts.total, `${name}.total`),
  };
}

// A run without `--cov-branch` (or `branch = true`) has no branch counts.
function coveragePyFileCoverage(summary: unknown, name: string): PackageCoverage {
  const fields = asJsonObject(summary, name);
  const lines = {
    covered: asCount(fields.covered_lines, `${name}.covered_lines`),
    total: asCount(fields.num_statements, `${name}.num_statements`),
  };

  if (fields.num_branches === undefined) return { lines };

  return {
    lines,
    branches: {
      covered: asCount(fields.covered_branches, `${name}.covered_branches`),
      total: asCount(fields.num_branches, `${name}.num_branches`),
    },
  };
}

function coberturaCount(rootTag: string, attribute: string, reportName: string): number {
  const value = new RegExp(`\\s${attribute}="(\\d+)"`, "u").exec(rootTag)?.[1];

  if (value === undefined)
    throw new CoverageInputError(
      `${reportName}: the <coverage> element has no ${attribute} count.`,
    );

  return Number(value);
}

export function parseJsonObject(text: string, name: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CoverageInputError(
      `${name}: not JSON (${error instanceof Error ? error.message : String(error)}).`,
    );
  }

  return asJsonObject(parsed, name);
}

export function asJsonObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new CoverageInputError(`${name}: expected a JSON object.`);

  return value as Record<string, unknown>;
}

function asCount(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    throw new CoverageInputError(`${name}: expected a count, got ${JSON.stringify(value)}.`);

  return value;
}
