import {
  chmod,
  lstat,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
  INSTALL_MARKER_FILE,
  OWNED_SKILL_PREFIX,
  ownedSkillEntries,
  SkillsSwapError,
  type StagedSkills,
  type SwapReport,
  stageSkills,
  swapStagedSkills,
} from "./staged-skills.js";

// `seampact agents install`: writes the seampact block into AGENTS.md between two markers and copies the skills the
// package ships (`skills/`, one folder per skill) into the skills folders of the project. A second run rewrites the
// block and replaces the `seampact-` skill folders it wrote (they hold a marker file), and touches nothing else.
// Every check comes before the first write: no target may leave the project, and no link on the way may resolve
// outside it. The skills are staged and swapped in, and AGENTS.md is written last, so a failed copy leaves the
// project as it was. The swap is atomic per target, not across targets: a swap that fails on a later target leaves
// the earlier ones on the new skills. A process that replaces a folder with a link between the check and the write
// is not caught.

export const AGENTS_FILE_NAME = "AGENTS.md";
export const DEFAULT_SKILLS_DIRECTORY = ".agents/skills";
export const CLAUDE_SKILLS_DIRECTORY = ".claude/skills";

const NODE_COMMAND = "npx seampact";
const AGENTS_BLOCK_TEMPLATE_FILE = "agents-block.md";
const MISSING_FOLDER_CODES = new Set<unknown>(["ENOENT", "ENOTDIR"]);
const PERMISSION_BITS = 0o7777;
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
  const installed = await installSkills(io, skillsSource, skillNames, targets);

  if (installed !== undefined) {
    printProblems(io, [installed]);

    return EXIT_REFUSED;
  }

  for (const target of targets)
    io.stdout(
      `Installed ${skillNames.length} skills in ${portablePath(relative(io.cwd, target))}.\n`,
    );

  try {
    await replaceAgentsFile(agentsFile, merge.text);
  } catch (error) {
    printProblems(io, [agentsFileFailed(error)]);

    return EXIT_REFUSED;
  }

  io.stdout(`${agentsFileReport(existing, merge.previousVersion, version)}\n`);

  return EXIT_SUCCESS;
}

// Written beside the file and renamed over it; `wx` refuses to follow a link left at the temporary path.
async function replaceAgentsFile(agentsFile: string, text: string): Promise<void> {
  const temporary = `${agentsFile}${TEMPORARY_SUFFIX}`;

  const mode = await stat(agentsFile).then(
    (stats) => stats.mode & PERMISSION_BITS,
    () => undefined,
  );

  await rm(temporary, { force: true });
  await writeFile(temporary, text, { flag: "wx" });

  if (mode !== undefined) await chmod(temporary, mode);

  await rename(temporary, agentsFile);
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
// the way to a skills folder that is a link leaving the project, or a `seampact-` folder in it that is a link.
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

    const linked = await linkedSegment(cwd, projectRoot, target);

    if (linked !== undefined) return linkLeavesProject(portablePath(relative(cwd, linked)));

    if (!isInsideOrEqual(projectRoot, await realExistingAncestor(target)))
      return outsideProject(directory);

    for (const entry of await ownedSkillEntries(target))
      if (entry.isSymbolicLink) return symbolicLink(`${portablePath(directory)}/${entry.name}`);
  }

  return undefined;
}

// True when the link resolves, and to a place inside the project.
async function staysInside(projectRoot: string, link: string): Promise<boolean> {
  const real = await realpath(link).catch(() => undefined);

  return real !== undefined && isInsideOrEqual(projectRoot, real);
}

// The first folder from the project root down to the target that is a symbolic link dangling or leaving the project. The walk stops at the
// first path that is missing or not a folder: the copy then reports it.
async function linkedSegment(
  cwd: string,
  projectRoot: string,
  target: string,
): Promise<string | undefined> {
  let path = resolve(cwd);

  for (const segment of relative(cwd, target).split(sep)) {
    path = join(path, segment);

    const stats = await lstat(path).catch((error: unknown) => {
      if (errorCode(error) === "ENOENT") return undefined;

      throw error;
    });

    if (stats?.isSymbolicLink() === true && !(await staysInside(projectRoot, path))) return path;

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
  io: CliIo,
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
      reportSwap(io, skills.target, await swapStagedSkills(skills, skillNames));
    } catch (error) {
      await discardStaged(staged.slice(index + 1));

      return swapFailed(skills.target, error);
    }
  }

  return undefined;
}

function reportSwap(io: CliIo, target: string, report: SwapReport): void {
  const folder = portablePath(relative(io.cwd, target));

  for (const name of report.pruned)
    io.stdout(`Removed ${folder}/${name}: this version ships no such skill.\n`);

  for (const name of report.left)
    io.stdout(
      `Left ${folder}/${name} alone: seampact did not write it (no ${INSTALL_MARKER_FILE} file).\n`,
    );

  if (report.leftoverStaging !== undefined)
    io.stdout(
      `The skills are installed, but ${portablePath(relative(io.cwd, report.leftoverStaging))} could not be deleted; remove it.\n`,
    );
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
    fix: `Replace '${path}' with a real file or folder, or pass another \`--skills-directory\`.`,
  };
}

function linkLeavesProject(path: string): CliProblem {
  return {
    code: "agents.symlink",
    message: `'${path}' is a symbolic link that points nowhere or outside the project; the install never writes through one, so nothing was written.`,
    fix: `Replace '${path}' with a real folder or a link to a folder inside the project, or pass another \`--skills-directory\`.`,
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
  const restored = error instanceof SkillsSwapError && error.restored;
  const outcome = restored
    ? "that folder was restored"
    : "that folder may be left half replaced (the reason names where the previous folders are)";

  return {
    code: "agents.install.failed",
    message: `Replacing the skills in ${target} failed and ${outcome}; the folders listed before it hold the new skills, and AGENTS.md was not changed: ${reasonOf(error)}`,
    fix: INSTALL_FAILED_FIX,
  };
}

function agentsFileFailed(error: unknown): CliProblem {
  return {
    code: "agents.install.failed",
    message: `The skills were installed, but writing ${AGENTS_FILE_NAME} failed and it was not changed: ${reasonOf(error)}`,
    fix: `Make ${AGENTS_FILE_NAME} writable and remove any \`${AGENTS_FILE_NAME}${TEMPORARY_SUFFIX}\` left beside it, then run \`agents install\` again.`,
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
