import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGES_DIR, packageDirectories } from "../workspace/index.ts";

export const CARTOGRAPHY_FILE = "docs/agents/cartography.md";
export const WRITE_COMMAND = "node scripts/cartography/cli.ts --write";

const SOURCE_DIR = "src";
const INDEX_FILE = "index.ts";
const README_FILE = "README.md";

const PYTHON_DIR = "python";
const PYTHON_MANIFEST = "pyproject.toml";
const PYTHON_MODULE_FILE = "__init__.py";
const PYTHON_GENERATED_MARKER = "# Generated from";

/** Directories under a Python `src` that hold no source. */
const PYTHON_SKIPPED_DIRS = new Set(["__pycache__", "schemas"]);

/** Directories that hold test data, not source. */
const SKIPPED_DIRS = new Set(["node_modules", "fixtures"]);

export interface CompilerStage {
  name: string;
  /** Repository-relative directories, in the order the map lists them. */
  directories: string[];
}

/** The compiler stages in pipeline order (ADR 0006 section 1). */
export const COMPILER_STAGES: CompilerStage[] = [
  { name: "load", directories: ["packages/core/compiler/src/load"] },
  { name: "validate", directories: ["packages/core/compiler/src/validate"] },
  {
    name: "tree",
    directories: [
      "packages/core/compiler/src/passes/tree/nodes",
      "packages/core/compiler/src/passes/tree/schemas",
    ],
  },
  {
    name: "access",
    directories: [
      "packages/core/compiler/src/passes/access/identity",
      "packages/core/compiler/src/passes/access/rights",
    ],
  },
  {
    name: "derive",
    directories: [
      "packages/core/compiler/src/passes/derive/wire",
      "packages/core/compiler/src/passes/derive/errors",
    ],
  },
  { name: "link", directories: ["packages/core/compiler/src/passes/link"] },
  { name: "finalize", directories: ["packages/core/compiler/src/finalize"] },
];

interface PackageEntry {
  name: string;
  directory: string;
  role: string;
  description: string;
  sourceDirectories: SourceDirectory[];
}

interface PythonPackageEntry {
  name: string;
  directory: string;
  description: string;
  sourceDirectories: SourceDirectory[];
}

interface SourceDirectory {
  path: string;
  summary: string;
}

export interface CartographyOptions {
  root: string;
  stages: CompilerStage[];
}

export interface Cartography {
  markdown: string;
  /** Each a repository-relative path, what is missing and the fix. */
  problems: string[];
}

export function buildCartography(options: CartographyOptions): Cartography {
  const problems: string[] = [];
  const packages = readPackages(options.root, problems);
  const pythonPackages = readPythonPackages(options.root, problems);

  for (const stage of options.stages) {
    for (const directory of stage.directories) {
      if (!existsSync(join(options.root, directory))) {
        problems.push(
          `${directory}: the directory of stage "${stage.name}" is missing; update COMPILER_STAGES in scripts/cartography/map.ts`,
        );
      }
    }
  }

  return {
    markdown: renderCartography(packages, pythonPackages, options.stages),
    problems: problems.sort(compareText),
  };
}

function readPackages(root: string, problems: string[]): PackageEntry[] {
  const packagesRoot = join(root, PACKAGES_DIR);

  if (!existsSync(packagesRoot)) {
    problems.push(`${PACKAGES_DIR}: no packages directory`);

    return [];
  }

  const entries: PackageEntry[] = [];

  for (const directory of packageDirectories(root)) {
    const manifestPath = join(root, directory, "package.json");

    const entry = readPackage(root, directory, manifestPath, problems);

    if (entry !== undefined) entries.push(entry);
  }

  return entries;
}

function readPackage(
  root: string,
  directory: string,
  manifestPath: string,
  problems: string[],
): PackageEntry | undefined {
  const manifestFile = `${directory}/package.json`;
  const manifest = parseManifest(manifestPath, manifestFile, problems);

  if (manifest === undefined) return undefined;

  const name = stringField(manifest, "name");

  if (name === undefined) {
    problems.push(`${manifestFile}: no \`name\`; add the package name`);
  }

  const description = stringField(manifest, "description");

  if (description === undefined) {
    problems.push(`${manifestFile}: no \`description\`; add a one-line description of the package`);
  }

  const seampactField = isRecord(manifest) ? manifest.seampact : undefined;
  const role = stringField(seampactField, "role");

  if (role === undefined) {
    problems.push(`${manifestFile}: no \`seampact.role\`; add the package's role`);
  }

  const sourceRoot = `${directory}/${SOURCE_DIR}`;
  const sourceDirectories = existsSync(join(root, sourceRoot))
    ? readSourceDirectories(root, sourceRoot, description ?? "", problems)
    : [];

  return {
    name: name ?? directory,
    directory,
    role: role ?? "",
    description: description ?? "",
    sourceDirectories,
  };
}

/**
 * Every directory under a package's `src` that holds a file, with its summary. A directory with
 * only subdirectories is a grouping directory and gets no line of its own.
 */
function readSourceDirectories(
  root: string,
  sourceRoot: string,
  packageDescription: string,
  problems: string[],
): SourceDirectory[] {
  const found: SourceDirectory[] = [];

  const visit = (directory: string) => {
    const absolute = join(root, directory);

    for (const child of sortedSubdirectories(absolute)) visit(`${directory}/${child}`);

    if (!holdsAFile(absolute)) return;

    const header = readHeader(absolute);
    const summary = header ?? (directory === sourceRoot ? packageDescription : "");

    if (summary === "") {
      problems.push(
        `${directory}: no header; add a one-line comment at the top of ${directory}/${INDEX_FILE}, or a ${README_FILE}`,
      );

      return;
    }

    found.push({ path: directory, summary });
  };

  visit(sourceRoot);

  return found.sort((left, right) => compareText(left.path, right.path));
}

/** The packages of the uv workspace `python/`, each with the source directories that hold a module. */
function readPythonPackages(root: string, problems: string[]): PythonPackageEntry[] {
  const pythonRoot = join(root, PYTHON_DIR);

  if (!existsSync(pythonRoot)) return [];

  const entries: PythonPackageEntry[] = [];

  for (const child of sortedSubdirectories(pythonRoot)) {
    const directory = `${PYTHON_DIR}/${child}`;
    const manifestFile = `${directory}/${PYTHON_MANIFEST}`;

    if (!existsSync(join(root, manifestFile))) continue;

    const manifest = readFileSync(join(root, manifestFile), "utf8");
    const name = tomlProjectField(manifest, "name");
    const description = tomlProjectField(manifest, "description");

    if (name === undefined) problems.push(`${manifestFile}: no \`name\`; add the package name`);

    if (description === undefined) {
      problems.push(
        `${manifestFile}: no \`description\`; add a one-line description of the package`,
      );
    }

    entries.push({
      name: name ?? directory,
      directory,
      description: description ?? "",
      sourceDirectories: readPythonSourceDirectories(root, `${directory}/${SOURCE_DIR}`, problems),
    });
  }

  return entries;
}

/** A one-line string field of the `[project]` table; the manifests keep these on one line. */
function tomlProjectField(manifest: string, key: string): string | undefined {
  const projectTable = /^\[project\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(manifest);
  const line = new RegExp(`^${key} = "(.*)"$`, "m").exec(projectTable?.[1] ?? "");

  return line?.[1]?.trim() || undefined;
}

/**
 * Every package directory (one holding an `__init__.py`) under a Python `src`, with the first sentence
 * of its module docstring. A directory whose `__init__.py` is generated gets no line.
 */
function readPythonSourceDirectories(
  root: string,
  sourceRoot: string,
  problems: string[],
): SourceDirectory[] {
  const found: SourceDirectory[] = [];

  const visit = (directory: string) => {
    const absolute = join(root, directory);

    for (const child of sortedSubdirectories(absolute)) {
      if (!PYTHON_SKIPPED_DIRS.has(child)) visit(`${directory}/${child}`);
    }

    const modulePath = join(absolute, PYTHON_MODULE_FILE);

    if (!existsSync(modulePath)) return;

    const source = readFileSync(modulePath, "utf8");

    if (source.startsWith(PYTHON_GENERATED_MARKER)) return;

    const docstring = /^"""([\s\S]*?)"""/.exec(source)?.[1]?.replace(/\s+/g, " ").trim();

    if (docstring === undefined || docstring === "") {
      problems.push(
        `${directory}: no header; add a module docstring at the top of ${directory}/${PYTHON_MODULE_FILE}`,
      );

      return;
    }

    found.push({ path: directory, summary: firstSentence(docstring) });
  };

  visit(sourceRoot);

  return found.sort((left, right) => compareText(left.path, right.path));
}

function parseManifest(manifestPath: string, manifestFile: string, problems: string[]): unknown {
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    problems.push(`${manifestFile}: not valid JSON (${reason}); fix the file`);

    return undefined;
  }
}

/** The first sentence of the leading `//` comment of index.ts, else the first line of README.md. */
function readHeader(directory: string): string | undefined {
  const indexPath = join(directory, INDEX_FILE);

  if (existsSync(indexPath)) {
    const comment = leadingComment(readFileSync(indexPath, "utf8"));

    if (comment !== "") return firstSentence(comment);
  }

  const readmePath = join(directory, README_FILE);

  if (existsSync(readmePath)) {
    const firstLine = readFileSync(readmePath, "utf8")
      .split("\n")
      .map((line) => line.replace(/^#+/, "").trim())
      .find((line) => line !== "");

    if (firstLine !== undefined) return firstLine;
  }

  return undefined;
}

/** The text of the `//` lines that open the file, up to the first empty comment line. */
function leadingComment(source: string): string {
  const parts: string[] = [];

  for (const line of source.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("//")) break;

    const text = trimmed.slice(2).trim();

    if (text === "") break;
    parts.push(text);
  }

  return parts.join(" ");
}

function firstSentence(text: string): string {
  const end = /\.(\s|$)/.exec(text);

  return end === null ? text : text.slice(0, end.index + 1);
}

function renderCartography(
  packages: PackageEntry[],
  pythonPackages: PythonPackageEntry[],
  stages: CompilerStage[],
): string {
  const lines = [
    "# Cartography",
    "",
    `<!-- Generated by \`${WRITE_COMMAND}\`. Do not edit: change a package.json \`description\` or a directory header instead. -->`,
    "",
    "The workspace packages, the compiler stages and one line per source directory. A line comes from the first sentence of the leading comment of the directory's `index.ts`, else the first line of its `README.md`, else, for a package's `src`, the package description.",
    "",
    "## Packages",
    "",
    "| Package | Directory | Role | Description |",
    "|---|---|---|---|",
  ];

  for (const entry of packages) {
    lines.push(
      `| \`${entry.name}\` | \`${entry.directory}\` | ${tableCell(entry.role)} | ${tableCell(entry.description)} |`,
    );
  }

  if (pythonPackages.length > 0) {
    lines.push("", "## Python packages", "");
    lines.push(
      "The uv workspace `python/`. A source directory is a package with an `__init__.py`; its line is the first sentence of the module docstring, and a generated `__init__.py` gets none.",
      "",
    );
    lines.push("| Package | Directory | Description |", "|---|---|---|");

    for (const entry of pythonPackages) {
      lines.push(
        `| \`${entry.name}\` | \`${entry.directory}\` | ${tableCell(entry.description)} |`,
      );
    }
  }

  lines.push("", "## Compiler stages", "", "In pipeline order (ADR 0006 section 1).", "");
  lines.push("| Stage | Directories |", "|---|---|");

  for (const stage of stages) {
    const directories = stage.directories.map((directory) => `\`${directory}\``).join(", ");

    lines.push(`| ${stage.name} | ${directories} |`);
  }

  lines.push("", "## Source directories");

  for (const entry of packages) {
    if (entry.sourceDirectories.length === 0) continue;

    lines.push("", `### \`${entry.name}\``, "");

    for (const directory of entry.sourceDirectories) {
      lines.push(`- \`${directory.path}\`: ${directory.summary}`);
    }
  }

  for (const entry of pythonPackages) {
    if (entry.sourceDirectories.length === 0) continue;

    lines.push("", `### \`${entry.name}\``, "");

    for (const directory of entry.sourceDirectories) {
      lines.push(`- \`${directory.path}\`: ${directory.summary}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function tableCell(text: string): string {
  return text.replaceAll("|", "\\|");
}

function sortedSubdirectories(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SKIPPED_DIRS.has(entry.name))
    .map((entry) => entry.name)
    .sort(compareText);
}

function holdsAFile(directory: string): boolean {
  return readdirSync(directory, { withFileTypes: true }).some((entry) => entry.isFile());
}

/** Code-unit order, so the map does not depend on the machine's locale. */
function compareText(left: string, right: string): number {
  if (left === right) return 0;

  return left < right ? -1 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;

  const field = value[key];

  return typeof field === "string" && field.trim() !== "" ? field.trim() : undefined;
}
