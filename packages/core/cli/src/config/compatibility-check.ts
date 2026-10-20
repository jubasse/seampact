import type { Target } from "@seampact/codegen-core";
import {
  SERVER_TARGETS,
  supportedMajorsOf,
  type TargetCompatibility,
} from "@seampact/spec/compatibility";
import {
  DEFAULT_MATRIX_CHECK_LEVEL,
  type MatrixCheckLevel,
  type TargetEntry,
} from "@seampact/spec/config";
import { type CliProblem, entryWhere } from "../cli-problem.js";
import { type InstalledVersion, readInstalledVersion } from "./installed-version.js";
import type { LoadedAppConfig } from "./read-app-config.js";

// The compatibility matrix check (ADR 0009 "Artefacts and the compatibility matrix", ADR 0011 "The app config"):
// each server target entry against the framework major installed in the app, before anything is generated.
// Validator pairs are checked by codegen-core's link check.

export interface CompatibilityOutcome {
  problems: CliProblem[];
  warnings: CliProblem[];
}

export interface CompatibilityInput {
  entries: readonly TargetEntry[];
  // The resolved target of each entry, by entry id.
  targets: ReadonlyMap<string, Target>;
  // The installed version of each framework package the matrix records for the entries' targets, by package.
  installedVersions: ReadonlyMap<string, InstalledVersion>;
  matrix: readonly TargetCompatibility[];
  level: MatrixCheckLevel;
}

// Reads the installed framework versions from the app's project, then checks the app against the matrix.
export function checkAppCompatibility(
  config: LoadedAppConfig,
  targets: ReadonlyMap<string, Target>,
  matrix: readonly TargetCompatibility[] = SERVER_TARGETS,
): CompatibilityOutcome {
  const entries = config.entries.map(({ entry }) => entry);
  const installedVersions = new Map<string, InstalledVersion>();
  const readPackages = new Set<string>();
  const problems: CliProblem[] = [];

  for (const { entry, framework } of recordedEntries(entries, targets, matrix)) {
    if (readPackages.has(framework.package)) continue;

    readPackages.add(framework.package);

    const read = readInstalledVersion(config.file, framework.package, entryWhere(entry.id));

    if (read.status === "refused") problems.push(read.problem);
    else installedVersions.set(framework.package, read.installed);
  }

  if (problems.length > 0) return { problems, warnings: [] };

  return checkCompatibility({
    entries,
    targets,
    installedVersions,
    matrix,
    level: config.checks?.matrix ?? DEFAULT_MATRIX_CHECK_LEVEL,
  });
}

// Pure: the matrix is a parameter, so a test passes one with an incompatible major.
export function checkCompatibility(input: CompatibilityInput): CompatibilityOutcome {
  const outcome: CompatibilityOutcome = { problems: [], warnings: [] };

  for (const entry of input.entries) {
    const record = matrixRecordOf(entry, input.targets, input.matrix);

    if (record === undefined) {
      outcome.problems.push(...unrecordedTargetProblems(entry));
      continue;
    }

    const installed = input.installedVersions.get(record.framework.package);

    if (installed === undefined) {
      throw new Error(
        `no installed version of ${record.framework.package} for the entry ${entry.id}`,
      );
    }

    checkEntry(entry, record, installed, input.level, outcome);
  }

  return outcome;
}

function checkEntry(
  entry: TargetEntry,
  record: TargetCompatibility,
  installed: InstalledVersion,
  level: MatrixCheckLevel,
  outcome: CompatibilityOutcome,
): void {
  const { framework } = record;
  const allowed = entry.allowUntested ?? [];

  outcome.problems.push(...foreignFrameworkProblems(entry, framework.id, allowed));
  outcome.warnings.push(...testedMajorWarnings(entry, record, allowed));

  const incompatible = framework.incompatible.find((each) => each.major === installed.major);

  if (incompatible !== undefined) {
    outcome.problems.push({
      code: "config.matrix.incompatible",
      message: `${framework.package} ${installed.version} is installed, and the target '${entry.use}' does not work on ${framework.id} ${installed.major}: ${incompatible.reason}`,
      fix: `Install a major of ${framework.package} the target is tested on: ${testedMajorsText(record)}.`,
      where: entryWhere(entry.id),
    });

    return;
  }

  const isTested = supportedMajorsOf(record).includes(installed.major);
  const allowItem = `${framework.id}@${installed.major}`;

  if (isTested || allowed.includes(allowItem)) return;

  const untested = {
    code: "config.matrix.untested",
    message: `${framework.package} ${installed.version} is installed, and the target '${entry.use}' is tested on ${framework.id} ${testedMajorsText(record)} only.`,
    fix: `Install a tested major, or accept this one with \`allowUntested: [${allowItem}]\` on the entry.`,
    where: entryWhere(entry.id),
  };

  if (level === "error") outcome.problems.push(untested);
  else outcome.warnings.push(untested);
}

// Each `allowUntested` item naming another framework than the one the target serves.
function foreignFrameworkProblems(
  entry: TargetEntry,
  frameworkId: string,
  allowed: readonly string[],
): CliProblem[] {
  return allowed
    .filter((item) => frameworkIdOf(item) !== frameworkId)
    .map((item) => ({
      code: "config.matrix.unknown-framework",
      message: `The \`allowUntested\` item '${item}' names the framework '${frameworkIdOf(item)}', and the target '${entry.use}' serves '${frameworkId}'.`,
      fix: `Write the item as '${frameworkId}@<major>', or remove it.`,
      where: entryWhere(entry.id),
    }));
}

// An item naming a tested major accepts nothing: a warning, so that a seampact upgrade testing it breaks no build.
function testedMajorWarnings(
  entry: TargetEntry,
  record: TargetCompatibility,
  allowed: readonly string[],
): CliProblem[] {
  const testedItems = supportedMajorsOf(record).map((major) => `${record.framework.id}@${major}`);

  return allowed
    .filter((item) => testedItems.includes(item))
    .map((item) => ({
      code: "config.matrix.allowed-tested",
      message: `The \`allowUntested\` item '${item}' names a major the compatibility matrix tests the target '${entry.use}' on, so it accepts nothing.`,
      fix: `Remove '${item}' from the entry's \`allowUntested\`.`,
      where: entryWhere(entry.id),
    }));
}

// A target the matrix does not record gets no framework check, so `allowUntested` would silence nothing.
function unrecordedTargetProblems(entry: TargetEntry): CliProblem[] {
  if (entry.allowUntested === undefined) return [];

  return [
    {
      code: "config.matrix.unrecorded-target",
      message: `The compatibility matrix records no framework for the target '${entry.use}', so \`allowUntested\` has nothing to accept.`,
      fix: "Remove `allowUntested` from the entry.",
      where: entryWhere(entry.id),
    },
  ];
}

function recordedEntries(
  entries: readonly TargetEntry[],
  targets: ReadonlyMap<string, Target>,
  matrix: readonly TargetCompatibility[],
): { entry: TargetEntry; framework: TargetCompatibility["framework"] }[] {
  return entries.flatMap((entry) => {
    const record = matrixRecordOf(entry, targets, matrix);

    return record === undefined ? [] : [{ entry, framework: record.framework }];
  });
}

function matrixRecordOf(
  entry: TargetEntry,
  targets: ReadonlyMap<string, Target>,
  matrix: readonly TargetCompatibility[],
): TargetCompatibility | undefined {
  const target = targets.get(entry.id);

  if (target === undefined) throw new Error(`no resolved target for the entry ${entry.id}`);

  return matrix.find((record) => record.package === target.metadata.packageName);
}

function testedMajorsText(record: TargetCompatibility): string {
  return supportedMajorsOf(record).join(", ");
}

// `<framework>@<major>`, as the schema checked it.
function frameworkIdOf(item: string): string {
  return item.slice(0, item.lastIndexOf("@"));
}
