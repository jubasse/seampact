import type { Target } from "@seampact/codegen-core";
import { OWN_VALIDATORS_ARTEFACT } from "@seampact/codegen-core/node-server";
import {
  type LibrarySupport,
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
import { selectArtefacts } from "./artefact-switches.js";
import {
  FRAMEWORK_MISSING_CODE,
  type InstalledVersion,
  readInstalledVersion,
} from "./installed-version.js";
import { installFix } from "./package-manager.js";
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
  // The installed version of the framework package the matrix records for each entry's target, by entry id.
  installedVersions: ReadonlyMap<string, InstalledVersion>;
  // The installed version of each library the entry's switched-on artefacts import, by entry id.
  installedLibraries?: ReadonlyMap<string, readonly InstalledVersion[]>;
  matrix: readonly TargetCompatibility[];
  level: MatrixCheckLevel;
}

// Reads each entry's installed framework version from its output directory, where the generated code resolves its
// imports, then checks the app against the matrix.
export function checkAppCompatibility(
  config: LoadedAppConfig,
  targets: ReadonlyMap<string, Target>,
  matrix: readonly TargetCompatibility[] = SERVER_TARGETS,
): CompatibilityOutcome {
  const entries = config.entries.map(({ entry }) => entry);
  const outputRoots = new Map(config.entries.map(({ entry, root }) => [entry.id, root]));
  const installedVersions = new Map<string, InstalledVersion>();
  const installedLibraries = new Map<string, readonly InstalledVersion[]>();
  const problems: CliProblem[] = [];

  for (const { entry, record } of recordedEntries(entries, targets, matrix)) {
    const root = outputRoots.get(entry.id);

    if (root === undefined) throw new Error(`no output root for the entry ${entry.id}`);

    const where = entryWhere(entry.id);
    const read = readInstalledVersion(root, record.framework.package, "framework", where);

    if (read.status === "refused") problems.push(read.problem);
    else installedVersions.set(entry.id, read.installed);

    const libraries: InstalledVersion[] = [];

    for (const library of librariesInUse(entry, targets, record)) {
      const readLibrary = readInstalledVersion(root, library.package, "validatorLibrary", where);

      if (readLibrary.status === "refused") problems.push(readLibrary.problem);
      else libraries.push(readLibrary.installed);
    }

    installedLibraries.set(entry.id, libraries);
    problems.push(...ownValidatorsLibraryProblems(entry, targets, record, root));
  }

  if (problems.length > 0) return { problems, warnings: [] };

  return checkCompatibility({
    entries,
    targets,
    installedVersions,
    installedLibraries,
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

    const installed = input.installedVersions.get(entry.id);

    if (installed === undefined) {
      throw new Error(
        `no installed version of ${record.framework.package} for the entry ${entry.id}`,
      );
    }

    checkEntry(entry, record, installed, input.level, outcome);

    for (const library of input.installedLibraries?.get(entry.id) ?? []) {
      checkLibrary(entry, record, library, input.level, outcome);
    }
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

  outcome.problems.push(
    ...foreignFrameworkProblems(entry, knownIds(record), framework.id, allowed),
  );
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

  reportUntestedMajor(
    entry,
    { id: framework.id, testedMajors: supportedMajorsOf(record) },
    installed,
    level,
    outcome,
  );
}

// A library the entry's artefact imports: tested majors only, no incompatible record.
function checkLibrary(
  entry: TargetEntry,
  record: TargetCompatibility,
  installed: InstalledVersion,
  level: MatrixCheckLevel,
  outcome: CompatibilityOutcome,
): void {
  const library = record.libraries?.find((each) => each.package === installed.packageName);

  if (library === undefined) {
    throw new Error(`no library record ${installed.packageName} for the entry ${entry.id}`);
  }

  reportUntestedMajor(entry, library, installed, level, outcome);
}

// An installed major the matrix does not test is a warning, an error under `checks.matrix: error`, and nothing when
// the entry accepts it in `allowUntested`.
function reportUntestedMajor(
  entry: TargetEntry,
  subject: { id: string; testedMajors: readonly number[] },
  installed: InstalledVersion,
  level: MatrixCheckLevel,
  outcome: CompatibilityOutcome,
): void {
  const allowItem = `${subject.id}@${installed.major}`;

  if (subject.testedMajors.includes(installed.major)) return;

  if ((entry.allowUntested ?? []).includes(allowItem)) return;

  const untested = {
    code: "config.matrix.untested",
    message: `${installed.packageName} ${installed.version} is installed, and the target '${entry.use}' is tested on ${subject.id} ${subject.testedMajors.join(", ")} only.`,
    fix: `Install a tested major, or accept this one with \`allowUntested: [${allowItem}]\` on the entry.`,
    where: entryWhere(entry.id),
  };

  if (level === "error") outcome.problems.push(untested);
  else outcome.warnings.push(untested);
}

// Each `allowUntested` item naming another framework than the one the target serves.
function foreignFrameworkProblems(
  entry: TargetEntry,
  knownFrameworkIds: readonly string[],
  frameworkId: string,
  allowed: readonly string[],
): CliProblem[] {
  return allowed
    .filter((item) => !knownFrameworkIds.includes(frameworkIdOf(item)))
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
  const testedItems = [
    ...supportedMajorsOf(record).map((major) => `${record.framework.id}@${major}`),
    ...(record.libraries ?? []).flatMap((library) =>
      library.testedMajors.map((major) => `${library.id}@${major}`),
    ),
  ];

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
  if ((entry.allowUntested?.length ?? 0) === 0) return [];

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
): { entry: TargetEntry; record: TargetCompatibility }[] {
  return entries.flatMap((entry) => {
    const record = matrixRecordOf(entry, targets, matrix);

    return record === undefined ? [] : [{ entry, record }];
  });
}

// The libraries of the record whose artefact the entry generates; an entry whose artefacts are refused is reported
// by the artefact selection, so it imports none here.
function librariesInUse(
  entry: TargetEntry,
  targets: ReadonlyMap<string, Target>,
  record: TargetCompatibility,
): readonly LibrarySupport[] {
  const target = targets.get(entry.id);

  if (target === undefined) throw new Error(`no resolved target for the entry ${entry.id}`);

  const selection = selectArtefacts(entry, target);

  if (selection.status === "refused") return [];

  return (record.libraries ?? []).filter((library) => selection.artefacts.has(library.artefact));
}

// The library the target's own validators import, when the entry writes them: no linked validators provider, and the
// `validators` artefact on. Only its presence is checked; the matrix records no tested major for it.
function ownValidatorsLibraryProblems(
  entry: TargetEntry,
  targets: ReadonlyMap<string, Target>,
  record: TargetCompatibility,
  root: string,
): CliProblem[] {
  const [ownValidator] = record.ownValidators;
  const target = targets.get(entry.id);

  if (ownValidator === undefined || target === undefined) return [];

  if (entry.link?.validators !== undefined) return [];

  const selection = selectArtefacts(entry, target);

  if (selection.status === "refused" || !selection.artefacts.has(OWN_VALIDATORS_ARTEFACT))
    return [];

  const where = entryWhere(entry.id);
  const read = readInstalledVersion(root, ownValidator.library, "validatorLibrary", where);

  if (read.status === "installed") return [];

  if (read.problem.code !== FRAMEWORK_MISSING_CODE) return [read.problem];

  return [
    {
      code: "config.own-validators.library-missing",
      message: `The target '${entry.use}' writes its own validators, which import '${ownValidator.library}', and it is not installed in the project of the entry's output directory (${root}).`,
      fix: installFix(root, ownValidator.library, "runtime"),
      where,
    },
  ];
}

// The ids `allowUntested` may name: the framework and each library of the target.
function knownIds(record: TargetCompatibility): readonly string[] {
  return [record.framework.id, ...(record.libraries ?? []).map((library) => library.id)];
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
