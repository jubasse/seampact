import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, printProblems } from "../cli-io.js";
import type { CliProblem } from "../cli-problem.js";
import { isInsideOrEqual } from "../config/path-containment.js";
import { errorCode } from "../error-code.js";
import { mergeAgentsBlock, renderAgentsBlock } from "./agents-block.js";

// `seampact agents install`: writes the seampact block into AGENTS.md between two markers and copies the skills the
// package ships (`skills/`, one folder per skill) into the skills folders of the project. A second run rewrites the
// block and replaces the seampact skill folders, and touches nothing else. Every refusal comes before the first write.

export const AGENTS_FILE_NAME = "AGENTS.md";
export const DEFAULT_SKILLS_DIRECTORY = ".agents/skills";
export const CLAUDE_SKILLS_DIRECTORY = ".claude/skills";

const NODE_COMMAND = "npx seampact";
const AGENTS_BLOCK_TEMPLATE_FILE = "agents-block.md";
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

  const outside = options.skillsDirectories.find(
    (directory) => !isInsideProject(io.cwd, directory),
  );

  if (outside !== undefined) {
    printProblems(io, [outsideProject(outside)]);

    return EXIT_REFUSED;
  }

  const [primary] = options.skillsDirectories;

  if (primary === undefined) throw new Error("agents install needs at least one skills folder.");

  const template = await readFile(join(skillsSource, AGENTS_BLOCK_TEMPLATE_FILE), "utf8");
  const block = renderAgentsBlock(template, {
    seampact: NODE_COMMAND,
    skillsDirectory: portablePath(primary),
  });
  const agentsFile = join(io.cwd, AGENTS_FILE_NAME);
  const existing = await readOptionalText(agentsFile);
  const merge = mergeAgentsBlock(existing, block, await installedVersion());

  if (merge.status === "refused") {
    printProblems(io, [merge.problem]);

    return EXIT_REFUSED;
  }

  await writeFile(agentsFile, merge.text);
  io.stdout(`${existing === undefined ? "Created" : "Updated"} ${AGENTS_FILE_NAME}.\n`);

  for (const directory of options.skillsDirectories) {
    await copySkills(skillsSource, skillNames, join(io.cwd, directory));
    io.stdout(`Installed ${skillNames.length} skills in ${portablePath(directory)}.\n`);
  }

  return EXIT_SUCCESS;
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

// Only the folders of the shipped skills are replaced: a skill of the project beside them stays.
async function copySkills(
  skillsSource: string,
  skillNames: readonly string[],
  target: string,
): Promise<void> {
  await mkdir(target, { recursive: true });

  for (const name of skillNames) {
    await rm(join(target, name), { recursive: true, force: true });
    await cp(join(skillsSource, name), join(target, name), { recursive: true });
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

function isInsideProject(cwd: string, directory: string): boolean {
  return !isAbsolute(directory) && isInsideOrEqual(cwd, resolve(cwd, directory));
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
    message: `The skills folder '${directory}' is not inside the working directory.`,
    fix: "Pass a relative path below the project, such as `--skills-directory .agents/skills`.",
  };
}
