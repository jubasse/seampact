import { cp, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { errorCode } from "../error-code.js";

// The skill folders of one install, copied first into a staging folder beside them and then swapped in by renames,
// so a failed copy leaves the project as it was. The install writes a marker file in each folder it copies; a second
// run replaces the `seampact-` folders that hold the marker, which also removes a skill an older version shipped and
// this one does not. A `seampact-` folder without the marker is the user's and stays.

export const OWNED_SKILL_PREFIX = "seampact-";
export const INSTALL_MARKER_FILE = ".seampact-installed";

const STAGING_PREFIX = ".seampact-staging-";
const PREVIOUS_FOLDER = "previous";

export interface StagedSkills {
  /** The skills folder of the project the skills go to. */
  readonly target: string;
  /** The folder holding the new copies until the swap. */
  readonly staging: string;
  /** The first folder `mkdir` created on the way to the target, removed when the install fails. */
  readonly createdDirectory: string | undefined;
}

/** Copies the shipped skills into a staging folder inside each target; on a failure removes what it made, then throws. */
export async function stageSkills(
  skillsSource: string,
  skillNames: readonly string[],
  targets: readonly string[],
): Promise<StagedSkills[]> {
  const staged: StagedSkills[] = [];

  try {
    for (const target of targets) {
      const createdDirectory = await mkdir(target, { recursive: true });
      const staging = await mkdtemp(join(target, STAGING_PREFIX));

      staged.push({ target, staging, createdDirectory });

      for (const name of skillNames) await copySkill(join(skillsSource, name), join(staging, name));
    }
  } catch (error) {
    await discardStaged(staged);

    throw error;
  }

  return staged;
}

async function copySkill(source: string, destination: string): Promise<void> {
  await cp(source, destination, { recursive: true });
  await writeFile(
    join(destination, INSTALL_MARKER_FILE),
    "Written by `seampact agents install`.\n",
  );
}

/** Removes the staging folders, and the folders the staging created. */
export async function discardStaged(staged: readonly StagedSkills[]): Promise<void> {
  for (const { staging, createdDirectory } of staged) {
    await rm(staging, { recursive: true, force: true });

    if (createdDirectory !== undefined)
      await rm(createdDirectory, { recursive: true, force: true });
  }
}

export interface SwapReport {
  /** The folders of an older install removed because this version ships no skill of that name. */
  readonly pruned: readonly string[];
  /** The `seampact-` folders without the marker, which are the user's and were left alone. */
  readonly left: readonly string[];
  /** Set when the swap is complete but the staging folder could not be deleted. */
  readonly leftoverStaging: string | undefined;
}

/** A swap that failed: `restored` says whether the target holds its previous folders again. */
export class SkillsSwapError extends Error {
  constructor(
    readonly reason: string,
    readonly restored: boolean,
  ) {
    super(reason);
  }
}

/** Moves the previous installed folders aside, the staged ones in, then deletes the previous ones. */
export async function swapStagedSkills(
  staged: StagedSkills,
  skillNames: readonly string[],
): Promise<SwapReport> {
  const previous = join(staged.staging, PREVIOUS_FOLDER);
  const movedOut: string[] = [];
  const movedIn: string[] = [];
  let report: Omit<SwapReport, "leftoverStaging">;

  try {
    await mkdir(previous);

    const { installed, foreign } = await classifyOwnedFolders(staged.target);

    report = {
      pruned: installed.filter((name) => !skillNames.includes(name)),
      left: foreign.filter((name) => !skillNames.includes(name)),
    };

    for (const name of installed) {
      await rename(join(staged.target, name), join(previous, name));
      movedOut.push(name);
    }

    for (const name of skillNames) {
      await rename(join(staged.staging, name), join(staged.target, name));
      movedIn.push(name);
    }
  } catch (error) {
    throw await restorePrevious(staged, previous, movedIn, movedOut, error);
  }

  const leftoverStaging = await rm(staged.staging, { recursive: true }).then(
    () => undefined,
    () => staged.staging,
  );

  return { ...report, leftoverStaging };
}

async function restorePrevious(
  staged: StagedSkills,
  previous: string,
  movedIn: readonly string[],
  movedOut: readonly string[],
  cause: unknown,
): Promise<SkillsSwapError> {
  const reason = cause instanceof Error ? cause.message : String(cause);

  try {
    for (const name of movedIn) await rename(join(staged.target, name), join(staged.staging, name));

    for (const name of movedOut) await rename(join(previous, name), join(staged.target, name));

    await rm(staged.staging, { recursive: true, force: true });
  } catch (restoreError) {
    const restoreReason =
      restoreError instanceof Error ? restoreError.message : String(restoreError);

    return new SkillsSwapError(
      `${reason}; putting the previous folders back also failed (${restoreReason}), they are in ${previous}`,
      false,
    );
  }

  return new SkillsSwapError(reason, true);
}

async function classifyOwnedFolders(
  target: string,
): Promise<{ installed: string[]; foreign: string[] }> {
  const installed: string[] = [];
  const foreign: string[] = [];

  for (const { name } of await ownedSkillEntries(target)) {
    const marked = await stat(join(target, name, INSTALL_MARKER_FILE)).then(
      () => true,
      () => false,
    );

    (marked ? installed : foreign).push(name);
  }

  return { installed, foreign };
}

/** The entries of a skills folder the install owns, symbolic links included; none when the folder does not exist. */
export async function ownedSkillEntries(
  target: string,
): Promise<{ readonly name: string; readonly isSymbolicLink: boolean }[]> {
  const entries = await readdir(target, { withFileTypes: true }).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return [];

    throw error;
  });

  return entries
    .filter((entry) => entry.name.startsWith(OWNED_SKILL_PREFIX))
    .map((entry) => ({ name: entry.name, isSymbolicLink: entry.isSymbolicLink() }));
}
