import { cp, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { errorCode } from "../error-code.js";

// The skill folders of one install, copied first into a staging folder beside them and then swapped in by renames,
// so a failed copy leaves the project as it was. Every `seampact-` folder belongs to the install: a second run
// replaces them all, which also removes a skill an older version shipped and this one does not.

export const OWNED_SKILL_PREFIX = "seampact-";

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

      for (const name of skillNames)
        await cp(join(skillsSource, name), join(staging, name), { recursive: true });
    }
  } catch (error) {
    await discardStaged(staged);

    throw error;
  }

  return staged;
}

/** Removes the staging folders, and the folders the staging created. */
export async function discardStaged(staged: readonly StagedSkills[]): Promise<void> {
  for (const { staging, createdDirectory } of staged) {
    await rm(staging, { recursive: true, force: true });

    if (createdDirectory !== undefined)
      await rm(createdDirectory, { recursive: true, force: true });
  }
}

/** Moves the previous `seampact-` folders aside, the staged ones in, then deletes the previous ones. */
export async function swapStagedSkills(
  staged: StagedSkills,
  skillNames: readonly string[],
): Promise<void> {
  const previous = join(staged.staging, PREVIOUS_FOLDER);
  const previousNames = await ownedSkillFolders(staged.target);
  const movedOut: string[] = [];
  const movedIn: string[] = [];

  await mkdir(previous);

  try {
    for (const name of previousNames) {
      await rename(join(staged.target, name), join(previous, name));
      movedOut.push(name);
    }

    for (const name of skillNames) {
      await rename(join(staged.staging, name), join(staged.target, name));
      movedIn.push(name);
    }
  } catch (error) {
    await restorePrevious(staged, previous, movedIn, movedOut);

    throw error;
  }

  await rm(staged.staging, { recursive: true });
}

async function restorePrevious(
  staged: StagedSkills,
  previous: string,
  movedIn: readonly string[],
  movedOut: readonly string[],
): Promise<void> {
  for (const name of movedIn) await rename(join(staged.target, name), join(staged.staging, name));

  for (const name of movedOut) await rename(join(previous, name), join(staged.target, name));

  await rm(staged.staging, { recursive: true, force: true });
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

async function ownedSkillFolders(target: string): Promise<string[]> {
  return (await ownedSkillEntries(target)).map((entry) => entry.name);
}
