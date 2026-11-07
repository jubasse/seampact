import { lstat, readdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, printProblems } from "../cli-io.js";
import type { CliProblem } from "../cli-problem.js";
import { isInsideOrEqual, isStrictlyInside } from "../config/path-containment.js";
import { errorCode } from "../error-code.js";
import { isSymbolicLink } from "../symbolic-link.js";
import { mergeAgentsBlock, renderAgentsBlock } from "./agents-block.js";
import {
  discardStaged,
  OWNED_SKILL_PREFIX,
  ownedSkillEntries,
  type StagedSkills,
  stageSkills,
  swapStagedSkills,
} from "./staged-skills.js";

// `seampact agents install`: writes the seampact block into AGENTS.md between two markers and copies the skills the
// package ships (`skills/`, one folder per skill) into the skills folders of the project. A second run rewrites the
// block and replaces the `seampact-` skill folders, and touches nothing else. Every check comes before the first
// write: no target may leave the project or go through a symbolic link. The skills are staged and swapped in, and
// AGENTS.md is written last, so a failed copy leaves the project as it was.

export const AGENTS_FILE_NAME = "AGENTS.md";
export const DEFAULT_SKILLS_DIRECTORY = ".agents/skills";
export const CLAUDE_SKILLS_DIRECTORY = ".claude/skills";

const NODE_COMMAND = "npx seampact";
const AGENTS_BLOCK_TEMPLATE_FILE = "agents-block.md";
const MISSING_FOLDER_CODES = new Set<unknown>(["ENOENT", "ENOTDIR"]);
const TEMPORARY_SUFFIX = ".seampact-tmp";
const PACKAGE_ROOT = new URL("../../", import.meta.url);
const SHIPPED_SKILLS = new URL("skills/", PACKAGE_ROOT);

export interface AgentsInstallOptions {
  /** The folders, relative to the working directory, the skills are copied to; the first one is named in the block. */
  readonly skillsDirectories: readonly string[];
}

export async function agentsInstallCommand(
  options: AgentsInstallOptions,
  io: CliIo,
): Promise<number> {
  const skillsSource = fileURLToPath(SHIPPED_SKILLS);
  const skillNames = await shippedSkillNames(skillsSource);

  if (skillNames.length === 0) {
    printProblems(io, [missingSkills(skillsSource)]);

    return EXIT_REFUSED;
  }

  const [primary] = options.skillsDirectories;

  if (primary === undefined) throw new Error("agents install needs at least one skills folder.");

  const agentsFile = join(io.cwd, AGENTS_FILE_NAME);
  const targetProblem = await unsafeTarget(io.cwd, options.skillsDirectories, agentsFile);

  if (targetProblem !== undefined) {
    printProblems(io, [targetProblem]);

    return EXIT_REFUSED;
  }

  const template = await readFile(join(skillsSource, AGENTS_BLOCK_TEMPLATE_FILE), "utf8");
  const block = renderAgentsBlock(template, {
    seampact: NODE_COMMAND,
    skillsDirectory: portablePath(primary),
  });
  const existing = await readOptionalText(agentsFile);
  const version = await installedVersion();
  const merge = mergeAgentsBlock(existing, block, version);

  if (merge.status === "refused") {
    printProblems(io, [merge.problem]);

    return EXIT_REFUSED;
  }

  const targets = uniqueTargets(io.cwd, options.skillsDirectories);
  const installed = await installSkills(skillsSource, skillNames, targets);

  if (installed !== undefined) {
    printProblems(io, [installed]);

    return EXIT_REFUSED;
  }

  for (const target of targets)
    io.stdout(
      `Installed ${skillNames.length} skills in ${portablePath(relative(io.cwd, target))}.\n`,
    );

  await writeFile(`${agentsFile}${TEMPORARY_SUFFIX}`, merge.text);
  await rename(`${agentsFile}${TEMPORARY_SUFFIX}`, agentsFile);
  io.stdout(`${agentsFileReport(existing, merge.previousVersion, version)}\n`);

  return EXIT_SUCCESS;
}

function agentsFileReport(
  existing: string | undefined,
  previousVersion: string | undefined,
  version: string,
): string {
  if (existing === undefined) return `Created ${AGENTS_FILE_NAME}.`;

  if (previousVersion === undefined || previousVersion === version)
    return `Updated ${AGENTS_FILE_NAME}.`;

  return `Updated ${AGENTS_FILE_NAME}: replaced the block of seampact ${previousVersion} with ${version}.`;
}

// The first reason a target is unsafe: a skills folder outside the project or equal to it, or AGENTS.md, a folder on
// the way to a skills folder, or a `seampact-` folder in it that is a symbolic link or resolves outside the project.
async function unsafeTarget(
  cwd: string,
  skillsDirectories: readonly string[],
  agentsFile: string,
): Promise<CliProblem | undefined> {
  if (await isSymbolicLink(agentsFile)) return symbolicLink(AGENTS_FILE_NAME);

  const projectRoot = await realpath(cwd);

  for (const directory of skillsDirectories) {
    const target = resolve(cwd, directory);

    if (isAbsolute(directory) || !isStrictlyInside(resolve(cwd), target))
      return outsideProject(directory);

    const linked = await linkedSegment(cwd, target);

    if (linked !== undefined) return symbolicLink(portablePath(relative(cwd, linked)));

    if (!isInsideOrEqual(projectRoot, await realExistingAncestor(target)))
      return outsideProject(directory);

    for (const entry of await ownedSkillEntries(target))
      if (entry.isSymbolicLink) return symbolicLink(`${portablePath(directory)}/${entry.name}`);
  }

  return undefined;
}

// The first folder from the project root down to the target that is a symbolic link, if any. The walk stops at the
// first path that is missing or not a folder: the copy then reports it.
async function linkedSegment(cwd: string, target: string): Promise<string | undefined> {
  let path = resolve(cwd);

  for (const segment of relative(cwd, target).split(sep)) {
    path = join(path, segment);

    const stats = await lstat(path).catch((error: unknown) => {
      if (errorCode(error) === "ENOENT") return undefined;

      throw error;
    });

    if (stats?.isSymbolicLink() === true) return path;

    if (stats?.isDirectory() !== true) return undefined;
  }

  return undefined;
}

// The real path of the target, or of its nearest ancestor that exists as a folder.
async function realExistingAncestor(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!MISSING_FOLDER_CODES.has(errorCode(error))) throw error;

    return realExistingAncestor(resolve(path, ".."));
  }
}

function uniqueTargets(cwd: string, skillsDirectories: readonly string[]): string[] {
  return [...new Set(skillsDirectories.map((directory) => resolve(cwd, directory)))];
}

// Stages every target before it swaps any, so an I/O failure while copying changes nothing.
async function installSkills(
  skillsSource: string,
  skillNames: readonly string[],
  targets: readonly string[],
): Promise<CliProblem | undefined> {
  let staged: StagedSkills[];

  try {
    staged = await stageSkills(skillsSource, skillNames, targets);
  } catch (error) {
    return installFailed(error);
  }

  for (const [index, skills] of staged.entries()) {
    try {
      await swapStagedSkills(skills, skillNames);
    } catch (error) {
      await discardStaged(staged.slice(index + 1));

      return swapFailed(skills.target, error);
    }
  }

  return undefined;
}

async function shippedSkillNames(skillsSource: string): Promise<string[]> {
  try {
    const entries = await readdir(skillsSource, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];

    throw error;
  }
}

async function readOptionalText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;

    throw error;
  }
}

async function installedVersion(): Promise<string> {
  const manifest: unknown = JSON.parse(
    await readFile(new URL("package.json", PACKAGE_ROOT), "utf8"),
  );

  if (typeof manifest === "object" && manifest !== null && "version" in manifest)
    if (typeof manifest.version === "string") return manifest.version;

  throw new Error("The package.json of @seampact/cli names no version.");
}

function portablePath(path: string): string {
  return posix.normalize(path.split(sep).join("/"));
}

function missingSkills(skillsSource: string): CliProblem {
  return {
    code: "agents.skills.missing",
    message: `This install of seampact ships no skills (looked in ${skillsSource}).`,
    fix: "Install `@seampact/cli` from npm, or copy the skills from https://github.com/jubasse/seampact/tree/develop/skills.",
  };
}

function outsideProject(directory: string): CliProblem {
  return {
    code: "agents.skills.outside",
    message: `The skills folder '${directory}' is not a folder inside the working directory.`,
    fix: "Pass a relative path below the project, such as `--skills-directory .agents/skills`.",
  };
}

function symbolicLink(path: string): CliProblem {
  return {
    code: "agents.symlink",
    message: `'${path}' is a symbolic link; the install never writes or deletes through one, so nothing was written.`,
    fix: `Replace '${path}' with a real file or folder inside the project, or pass another \`--skills-directory\`.`,
  };
}

const INSTALL_FAILED_FIX = `Make the skills folders and the \`${OWNED_SKILL_PREFIX}\` folders in them writable folders, then run \`agents install\` again.`;

function installFailed(error: unknown): CliProblem {
  return {
    code: "agents.install.failed",
    message: `Copying the skills failed, and the project was left as it was: ${reasonOf(error)}`,
    fix: INSTALL_FAILED_FIX,
  };
}

function swapFailed(target: string, error: unknown): CliProblem {
  return {
    code: "agents.install.failed",
    message: `Replacing the skills in ${target} failed and that folder was restored; the folders listed before it hold the new skills, and AGENTS.md was not changed: ${reasonOf(error)}`,
    fix: INSTALL_FAILED_FIX,
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
