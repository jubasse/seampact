// The Python side of the stamp: the `project.version` of every `python/*/pyproject.toml`, each requirement on
// another seampact distribution pinned `==<version>`, and the members' versions in `python/uv.lock`, so
// `uv sync --locked` still accepts the lock. Line edits, not a TOML rewrite, so the files keep their comments.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ReleaseError } from "./release-version.ts";
import { readRepositoryFile, type VersionEdit } from "./version-edit.ts";

const PYTHON_DIRECTORY = "python";
const PYPROJECT = "pyproject.toml";

export const UV_LOCK = "python/uv.lock";

const TABLE_HEADER = /^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/;
const PROJECT_TABLE = "project";
const OPTIONAL_DEPENDENCIES_TABLE = "project.optional-dependencies";
const NAME_LINE = /^name\s*=\s*"([^"]*)"/;
const VERSION_LINE = /^(version\s*=\s*")([^"]*)(")/;
const DEPENDENCIES_START = /^dependencies\s*=\s*\[/;
const QUOTED_STRING = /"([^"]*)"/g;
const REQUIREMENT = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?(.*)$/;
const EXACT_PIN = /^(\s*==\s*)([^;\s]+)(\s*(?:;.*)?)$/;

interface PinContext {
  readonly file: string;
  readonly memberNames: ReadonlySet<string>;
  readonly version: string;
  readonly changes: string[];
}

export interface Project {
  readonly file: string;
  readonly text: string;
  readonly name: string;
}

export function pythonVersionEdits(root: string, version: string): VersionEdit[] {
  const projects = pythonProjects(root);
  const memberNames = new Set(projects.map((project) => normalizedName(project.name)));

  return [
    ...projects.map((project) => projectEdit(project, memberNames, version)),
    lockEdit(root, projects, version),
  ];
}

/** Every Python project of the workspace with its distribution name, sorted by directory. */
export function pythonProjects(root: string): Project[] {
  const directory = join(root, PYTHON_DIRECTORY);

  if (!existsSync(directory))
    throw new ReleaseError(`${PYTHON_DIRECTORY}/ does not exist: the stamp writes its projects`);

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(directory, entry.name, PYPROJECT)))
    .map((entry) => entry.name)
    .sort()
    .map((member) => {
      const file = `${PYTHON_DIRECTORY}/${member}/${PYPROJECT}`;
      const text = readRepositoryFile(root, file);

      return { file, text, name: projectName(file, text) };
    });
}

function projectName(file: string, text: string): string {
  let table = "";

  for (const line of text.split("\n")) {
    table = TABLE_HEADER.exec(line)?.[1]?.trim() ?? table;

    const name = table === PROJECT_TABLE ? NAME_LINE.exec(line)?.[1] : undefined;

    if (name !== undefined) return name;
  }

  throw new ReleaseError(`${file} has no \`project.name\`: name the distribution`);
}

// PEP 503: names compare lower-cased, with runs of `-`, `_` and `.` as one `-`.
export function normalizedName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

function projectEdit(
  project: Project,
  memberNames: ReadonlySet<string>,
  version: string,
): VersionEdit {
  const changes: string[] = [];
  let table = "";
  let inDependencies = false;
  let versionFound = false;

  const lines = project.text.split("\n").map((line) => {
    const header = TABLE_HEADER.exec(line);

    if (header) {
      table = header[1]?.trim() ?? "";
      inDependencies = false;

      return line;
    }

    if (table === PROJECT_TABLE && VERSION_LINE.test(line)) {
      versionFound = true;

      return versionLine(line, version, changes);
    }

    if (table === PROJECT_TABLE && DEPENDENCIES_START.test(line)) inDependencies = true;

    if (!(inDependencies || table === OPTIONAL_DEPENDENCIES_TABLE)) return line;

    const edited = line.replace(QUOTED_STRING, (quoted, requirement: string) =>
      pinnedRequirement(quoted, requirement, { file: project.file, memberNames, version, changes }),
    );

    if (inDependencies && line.replace(QUOTED_STRING, "").includes("]")) inDependencies = false;

    return edited;
  });

  if (!versionFound)
    throw new ReleaseError(
      `${project.file} has no \`project.version\` line: give ${project.name} its version`,
    );

  return { file: project.file, before: project.text, after: lines.join("\n"), changes };
}

function versionLine(line: string, version: string, changes: string[]): string {
  return line.replace(VERSION_LINE, (whole, opening: string, current: string, closing: string) => {
    if (current === version) return whole;

    changes.push(`version is "${current}", not "${version}"`);

    return `${opening}${version}${closing}`;
  });
}

function pinnedRequirement(quoted: string, requirement: string, context: PinContext): string {
  const { file, memberNames, version, changes } = context;
  const parsed = REQUIREMENT.exec(requirement);
  const name = parsed?.[1];

  if (parsed === null || name === undefined || !memberNames.has(normalizedName(name)))
    return quoted;

  const pin = EXACT_PIN.exec(parsed[3] ?? "");

  if (pin === null)
    throw new ReleaseError(
      `${file}: the requirement "${requirement}" on a seampact distribution must be an exact \`==<version>\` pin`,
    );

  if (pin[2] === version) return quoted;

  changes.push(`requirement "${requirement}" does not pin ${version}`);

  return `"${name}${parsed[2] ?? ""}${pin[1]}${version}${pin[3] ?? ""}"`;
}

function lockEdit(root: string, projects: readonly Project[], version: string): VersionEdit {
  if (!existsSync(join(root, UV_LOCK)))
    throw new ReleaseError(`${UV_LOCK} does not exist: run \`uv lock\` in python/`);

  const before = readRepositoryFile(root, UV_LOCK);
  const changes: string[] = [];
  let after = before;

  for (const { name } of projects) {
    const entry = new RegExp(
      `(\\[\\[package\\]\\]\\nname = "${escapedForPattern(name)}"\\nversion = ")([^"]*)("\\nsource = \\{ editable = )`,
    );
    const locked = entry.exec(after);

    if (locked === null)
      throw new ReleaseError(
        `${UV_LOCK} has no editable entry for ${name}: run \`uv lock\` in python/`,
      );

    if (locked[2] === version) continue;

    changes.push(`${name} is locked at "${locked[2]}", not "${version}"`);
    after = after.replace(entry, `$1${version}$3`);
  }

  return { file: UV_LOCK, before, after, changes };
}

function escapedForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
