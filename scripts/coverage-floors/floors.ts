import {
  asJsonObject,
  type Counts,
  type CoverageByPackage,
  CoverageInputError,
  PERCENT,
  parseJsonObject,
  percentOf,
} from "./summaries.ts";

/** The lowest percentages a package's tests may cover; `branches` only where the tool counts branches. */
export interface PackageFloors {
  lines: number;
  branches?: number;
}

/**
 * `scripts/coverage-floors/floors.json`: the floors of each package, keyed by its repository-relative directory, and the
 * packages no CI job measures, each with the reason.
 */
export interface FloorsFile {
  packages: Map<string, PackageFloors>;
  notMeasured: Map<string, string>;
}

/** One line of the check: a package's metric, its measured percentage and its floor. */
export interface MetricResult {
  packageDirectory: string;
  metric: FloorMetric;
  percent: number;
  floor: number;
}

/** What the check found: every compared metric, and each problem as a sentence that names the fix. */
export interface FloorCheck {
  results: MetricResult[];
  problems: string[];
}

export const FLOOR_METRICS = ["lines", "branches"] as const;
export type FloorMetric = (typeof FLOOR_METRICS)[number];

const SHOWN_DECIMALS = 2;

export function parseFloorsFile(floorsText: string, floorsName: string): FloorsFile {
  const root = parseJsonObject(floorsText, floorsName);
  const packages = new Map<string, PackageFloors>();
  const notMeasured = new Map<string, string>();

  for (const [packageDirectory, floors] of Object.entries(
    asJsonObject(root.packages, `${floorsName}: packages`),
  )) {
    packages.set(
      packageDirectory,
      packageFloors(floors, `${floorsName}: packages.${packageDirectory}`),
    );
  }

  for (const [packageDirectory, reason] of Object.entries(
    asJsonObject(root.notMeasured, `${floorsName}: notMeasured`),
  )) {
    if (typeof reason !== "string" || reason.trim() === "")
      throw new CoverageInputError(
        `${floorsName}: notMeasured.${packageDirectory} needs the reason as a string.`,
      );

    if (packages.has(packageDirectory))
      throw new CoverageInputError(
        `${floorsName}: ${packageDirectory} has floors and is listed under notMeasured; keep one.`,
      );

    notMeasured.set(packageDirectory, reason);
  }

  return { packages, notMeasured };
}

/**
 * Compares measured coverage with the floors. `expectedPackagesDirectory` names the directory whose every floored
 * package the summary must contain (a whole-language run); without it only the measured packages are compared.
 */
export function checkFloors(
  measured: CoverageByPackage,
  floorsFile: FloorsFile,
  expectedPackagesDirectory?: string,
): FloorCheck {
  const results: MetricResult[] = [];
  const problems: string[] = [];

  for (const [packageDirectory, coverage] of [...measured].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const floors = floorsFile.packages.get(packageDirectory);

    if (floors === undefined) {
      // A notMeasured package may still appear with no counted line (a types-only package): nothing to check then.
      const listedAndEmpty = floorsFile.notMeasured.has(packageDirectory) && coverage.lines.total === 0;

      if (!listedAndEmpty) problems.push(missingFloorProblem(packageDirectory, floorsFile));
      continue;
    }

    if (coverage.lines.total === 0) {
      problems.push(measuredNothingProblem(packageDirectory));
      continue;
    }

    for (const metric of FLOOR_METRICS) {
      const floor = floors[metric];

      if (floor === undefined) continue;

      const counts: Counts | undefined = coverage[metric];

      if (counts === undefined) {
        problems.push(
          `${packageDirectory}: the summary has no ${metric} counts, but floors.json sets a ${metric} floor of ${floor}%; remove that floor if the tool counts no ${metric}.`,
        );
        continue;
      }

      const result = { packageDirectory, metric, percent: percentOf(counts), floor };

      results.push(result);

      if (result.percent < floor) problems.push(belowFloorProblem(result));
    }
  }

  if (expectedPackagesDirectory !== undefined)
    problems.push(...unmeasuredFloorProblems(measured, floorsFile, expectedPackagesDirectory));

  return { results, problems };
}

export function formatResult(result: MetricResult): string {
  return `${result.packageDirectory} ${result.metric} ${formatPercent(result.percent)} (floor ${result.floor}%)`;
}

function belowFloorProblem(result: MetricResult): string {
  return `${result.packageDirectory}: ${result.metric} coverage ${formatPercent(result.percent)} is under its floor of ${result.floor}%; add tests for the code this change leaves uncovered, or lower the floor in scripts/coverage-floors/floors.json with the reason in the pull request.`;
}

// A run that counted no line proves nothing: it would read as fully covered, so a floored package must not pass on it.
function measuredNothingProblem(packageDirectory: string): string {
  return `${packageDirectory}: the summary counts no lines, so nothing was measured; fix the coverage run (does the test run import the package's sources?) or, if it has no executable source, move it to notMeasured in scripts/coverage-floors/floors.json with the reason.`;
}

function missingFloorProblem(packageDirectory: string, floorsFile: FloorsFile): string {
  if (floorsFile.notMeasured.has(packageDirectory)) {
    return `${packageDirectory} is measured but listed under notMeasured in scripts/coverage-floors/floors.json; move it to packages with its measured value minus 1 point.`;
  }

  return `${packageDirectory} has no floor; add it to packages in scripts/coverage-floors/floors.json at its measured value minus 1 point, rounded down.`;
}

function unmeasuredFloorProblems(
  measured: CoverageByPackage,
  floorsFile: FloorsFile,
  expectedPackagesDirectory: string,
): string[] {
  const prefix = `${expectedPackagesDirectory}/`;

  return [...floorsFile.packages.keys()]
    .filter(
      (packageDirectory) => packageDirectory.startsWith(prefix) && !measured.has(packageDirectory),
    )
    .map(
      (packageDirectory) =>
        `${packageDirectory} has a floor but the summary measured none of its files; fix the coverage run or move it to notMeasured with the reason.`,
    );
}

function formatPercent(percent: number): string {
  return `${percent.toFixed(SHOWN_DECIMALS)}%`;
}

function packageFloors(value: unknown, name: string): PackageFloors {
  const floors = asJsonObject(value, name);
  const unknownKeys = Object.keys(floors).filter(
    (key) => !(FLOOR_METRICS as readonly string[]).includes(key),
  );

  if (unknownKeys.length > 0)
    throw new CoverageInputError(
      `${name}: unknown key ${unknownKeys.join(", ")}; a floor is lines or branches.`,
    );

  const lines = floorPercent(floors.lines, `${name}.lines`);

  if (lines === undefined) throw new CoverageInputError(`${name}: a lines floor is required.`);
  const branches = floorPercent(floors.branches, `${name}.branches`);

  return branches === undefined ? { lines } : { lines, branches };
}

function floorPercent(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > PERCENT) {
    throw new CoverageInputError(
      `${name}: a floor is a whole percentage from 0 to 100, got ${JSON.stringify(value)}.`,
    );
  }

  return value;
}
