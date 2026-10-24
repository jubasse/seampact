import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { loadFsReader, loadWorkspace } from "@seampact/compiler";
import { APP_CONFIG_FILE_NAME } from "@seampact/spec/config";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, printProblems } from "../cli-io.js";
import type { CliProblem } from "../cli-problem.js";
import { readAppConfig } from "../config/index.js";
import { DEFAULT_EDITOR_SCHEMAS_DIRECTORY, writeEditorSchemas } from "../editor-schemas/index.js";
import { compileCommand, planSourcesEditorSchemas } from "./compile-command.js";
import { compileSources } from "./compile-sources.js";
import { type ConfigLocation, configLocation, displayPath } from "./config-location.js";
import { type GitIgnoreChange, gitIgnoreWithEntries } from "./git-ignore.js";
import {
  STARTER_CONTRACT_FILE,
  STARTER_SOURCE_DIRECTORY,
  type StarterContent,
  starterConfig,
  starterContract,
} from "./init-starter.js";
import {
  INSTALLED_AUTHORING_SCHEMAS,
  modelineOf,
  withModeline,
  workspaceFileKinds,
} from "./modelines.js";
import { sourceEntryFile } from "./workspace-api-names.js";

/**
 * Where the editor schemas go (grammar section 3): written and git-ignored (`ignore`, the default), written and
 * committed (`commit`), or not written, the modelines then pointing at the installed `@seampact/spec` (`none`).
 */
export type EditorSchemasPolicy = "ignore" | "commit" | "none";

export const EDITOR_SCHEMAS_POLICIES: readonly EditorSchemasPolicy[] = ["ignore", "commit", "none"];

/** Whether `init` touches a file of a given sort (`--no-modelines`, `--no-ignore-files`). */
export type InitWrite = "write" | "skip";

export type InitOptions =
  | {
      /** `init`: a new project in the working directory. */
      readonly kind: "new-project";
      readonly content: StarterContent;
      readonly editorSchemas: EditorSchemasPolicy;
      readonly modelines: InitWrite;
      readonly ignoreFiles: InitWrite;
    }
  | {
      /** `init --modelines`: the modeline of every file of the app config's `path` sources. */
      readonly kind: "modelines";
      readonly location: ConfigLocation;
      readonly editorSchemas: EditorSchemasPolicy;
      readonly ignoreFiles: InitWrite;
    };

// The ignore entry of the default editor schemas directory, at any depth below the app root.
const DEFAULT_IGNORE_ENTRY = ".seampact/";

// `seampact init`: writes a new project, or the modelines of an existing one (grammar section 3). Every refusal
// comes before the first write, and every file written or changed is printed.
export async function initCommand(options: InitOptions, io: CliIo): Promise<number> {
  return options.kind === "new-project" ? initNewProject(options, io) : initModelines(options, io);
}

async function initNewProject(
  options: Extract<InitOptions, { kind: "new-project" }>,
  io: CliIo,
): Promise<number> {
  const configFile = join(io.cwd, APP_CONFIG_FILE_NAME);
  const sourceDirectory = join(io.cwd, STARTER_SOURCE_DIRECTORY);
  const contractFile = join(sourceDirectory, STARTER_CONTRACT_FILE);
  const existing = [configFile, sourceDirectory].filter((path) => existsSync(path));

  if (existing.length > 0) return refuse(io, [fileExistsProblem(io, existing)]);

  const ignore = await plannedIgnore(io.cwd, options, [DEFAULT_IGNORE_ENTRY]);
  const schemaDirectory =
    options.editorSchemas === "none"
      ? join(io.cwd, INSTALLED_AUTHORING_SCHEMAS)
      : join(sourceDirectory, DEFAULT_EDITOR_SCHEMAS_DIRECTORY);
  const contract = starterContract(options.content);

  await writeFile(configFile, starterConfig(options.content));
  io.stdout(`Created ${displayPath(io.cwd, configFile)}.\n`);
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(
    contractFile,
    options.modelines === "write"
      ? withModeline(contract, modelineOf(contractFile, schemaDirectory, "api"))
      : contract,
  );
  io.stdout(`Created ${displayPath(io.cwd, contractFile)}.\n`);

  if (options.editorSchemas !== "none") {
    const compiled = await compileCommand(
      configLocation(io.cwd, undefined),
      { irOutDir: undefined, editorSchemas: "write" },
      io,
    );

    if (compiled !== EXIT_SUCCESS) return compiled;
  }

  await writeIgnore(io, ignore);
  io.stdout("Run `seampact compile` after each change to the contract.\n");

  return EXIT_SUCCESS;
}

async function initModelines(
  options: Extract<InitOptions, { kind: "modelines" }>,
  io: CliIo,
): Promise<number> {
  const read = await readAppConfig(options.location.file, options.location.displayName);

  if (read.status === "refused") return refuse(io, read.problems);

  const { config } = read;
  const appRoot = dirname(config.file);
  const names = [...config.sources].flatMap(([name, source]) =>
    source.kind === "path" ? [name] : [],
  );

  if (names.length === 0) return refuse(io, [noPathSourceProblem(options.location)]);

  const compiled = await compileSources(config, names, io);

  if (compiled.failed) return refuse(io, compiled.problems);

  const planned =
    options.editorSchemas === "none"
      ? { problems: [], plans: [] }
      : await planSourcesEditorSchemas(config, names, compiled.apis, io);

  if (planned.problems.length > 0) return refuse(io, planned.problems);

  const edits: ModelineEdit[] = [];
  const ignoreEntries: string[] = [];

  for (const name of names) {
    const source = config.sources.get(name);

    if (source?.kind !== "path") throw new Error(`the source ${name} is not a path source`);

    const plan = planned.plans.find((each) => each.name === name)?.plan;
    const schemaDirectory = plan?.directory ?? join(appRoot, INSTALLED_AUTHORING_SCHEMAS);

    edits.push(...(await modelineEdits(source.directory, schemaDirectory, io)));

    if (plan !== undefined)
      ignoreEntries.push(ignoreEntry(appRoot, source.directory, plan.directory));
  }

  const ignore = await plannedIgnore(appRoot, options, ignoreEntries);

  for (const edit of edits) {
    await writeFile(edit.file, edit.text);
    io.stdout(`Wrote the modeline of ${displayPath(io.cwd, edit.file)}.\n`);
  }

  if (edits.length === 0) io.stdout("Every modeline was already right.\n");

  for (const { name, plan } of planned.plans) {
    const fileCount = await writeEditorSchemas(plan);

    io.stdout(`Wrote ${fileCount} editor schema(s) of source '${name}' to ${plan.directory}.\n`);
  }

  await writeIgnore(io, ignore);

  return EXIT_SUCCESS;
}

interface ModelineEdit {
  readonly file: string;
  readonly text: string;
}

// The files of one workspace whose modeline is missing or points elsewhere; each file left without one is printed.
async function modelineEdits(
  sourceDirectory: string,
  schemaDirectory: string,
  io: CliIo,
): Promise<ModelineEdit[]> {
  const entry = sourceEntryFile(sourceDirectory);

  // compileSources refused a directory without an entry file already.
  if (entry === undefined) throw new Error(`the source ${sourceDirectory} has no entry file`);

  const load = loadWorkspace({ reader: (io.sourceReader ?? loadFsReader)(sourceDirectory), entry });
  const { kinds, leftOut } = workspaceFileKinds(load);
  const edits: ModelineEdit[] = [];

  for (const [file, kind] of kinds) {
    const absolute = join(sourceDirectory, file);
    const text = await readFile(absolute, "utf8");
    const changed = withModeline(text, modelineOf(absolute, schemaDirectory, kind));

    if (changed !== text) edits.push({ file: absolute, text: changed });
  }

  for (const { file, reason } of leftOut)
    io.stdout(
      `Left ${displayPath(io.cwd, join(sourceDirectory, file))} without a modeline: ${reason}.\n`,
    );

  return edits;
}

// `.seampact/` for the default directory, else the directory itself from the app root.
function ignoreEntry(appRoot: string, sourceDirectory: string, schemaDirectory: string): string {
  if (posixRelative(sourceDirectory, schemaDirectory) === DEFAULT_EDITOR_SCHEMAS_DIRECTORY)
    return DEFAULT_IGNORE_ENTRY;

  return `/${posixRelative(appRoot, schemaDirectory)}/`;
}

function posixRelative(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

async function plannedIgnore(
  directory: string,
  options: Pick<InitOptions, "editorSchemas" | "ignoreFiles">,
  entries: readonly string[],
): Promise<GitIgnoreChange | undefined> {
  if (options.editorSchemas !== "ignore" || options.ignoreFiles === "skip" || entries.length === 0)
    return undefined;

  return gitIgnoreWithEntries(directory, entries);
}

async function writeIgnore(io: CliIo, ignore: GitIgnoreChange | undefined): Promise<void> {
  if (ignore === undefined || ignore.change === "unchanged") return;

  await writeFile(ignore.file, ignore.text);
  io.stdout(
    `${ignore.change === "created" ? "Created" : "Added the editor schemas to"} ${displayPath(io.cwd, ignore.file)}.\n`,
  );
}

function fileExistsProblem(io: CliIo, existing: readonly string[]): CliProblem {
  return {
    code: "init.file-exists",
    message: `\`seampact init\` writes a new project here, and ${existing.map((path) => displayPath(io.cwd, path)).join(" and ")} ${existing.length === 1 ? "already exists" : "already exist"}; nothing was written.`,
    fix: "Run `seampact init` in a folder without them, or run `seampact init --modelines` to add the modelines to the contracts of an existing app config.",
  };
}

function noPathSourceProblem(location: ConfigLocation): CliProblem {
  return {
    code: "init.modelines.no-source",
    message: `${location.displayName} names no \`path\` source, so no contract file here gets a modeline.`,
    fix: "Add a `path` source that names your contract folder; a bundle source's files are not edited.",
    where: location.displayName,
  };
}

function refuse(io: CliIo, problems: readonly CliProblem[]): number {
  printProblems(io, problems);

  return EXIT_REFUSED;
}
