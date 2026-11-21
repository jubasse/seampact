import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type FileState,
  type RecordedCall,
  type RecordedUnit,
  recordCalls,
  snapshotTree,
  writtenBetween,
} from "./call-recording.ts";
import { type ExpectedFiles, jsonText } from "./expected-text.ts";
import { buildGitSource, GIT_SOURCE_DIRECTORY, GIT_SOURCE_REPOSITORY } from "./git-source.ts";
import type { OracleTools } from "./tool-modules.ts";

// A CLI case: the command runs on a fresh copy of `tree/` (and the bare repository of `git-source/`), and the case
// keeps its transcript (`cli/transcript.json`) and the calls it made to the config readers, the editor schemas and
// the bundle fetch (`<unit>/<NN>-<function>.json`).

// `init` writes the config its own run then reads: replaying a read on the tree before the command cannot match.
const CONFIG_WRITING_COMMAND = "init";

export interface CliSpec {
  argv: string[];
  cwd?: string;
  env?: { SEAMPACT_CACHE_DIR?: string; SEAMPACT_ALLOW_LOCAL?: string };
}

export const ROOT_TOKEN = "<root>";
export const FIXED_TODAY = "2026-01-01";
const TREE_DIRECTORY = "tree";
const DEFAULT_CACHE_DIRECTORY = ".cache";
const ENVIRONMENT_NAMES = ["SEAMPACT_CACHE_DIR", "SEAMPACT_ALLOW_LOCAL"] as const;

export function cliSpecProblems(spec: unknown): string[] {
  if (typeof spec !== "object" || spec === null) return ["cli.json is an object"];

  const problems: string[] = [];
  const { argv, cwd, env, ...rest } = spec as Record<string, unknown>;

  if (!Array.isArray(argv) || !argv.every((item) => typeof item === "string"))
    problems.push("argv is an array of strings");

  if (cwd !== undefined && typeof cwd !== "string") problems.push("cwd is a string");

  for (const name of Object.keys(rest)) problems.push(`'${name}' is not a cli.json member`);

  if (typeof env === "object" && env !== null)
    for (const [name, value] of Object.entries(env)) {
      if (!(ENVIRONMENT_NAMES as readonly string[]).includes(name))
        problems.push(`env '${name}' is not one of ${ENVIRONMENT_NAMES.join(", ")}`);
      else if (typeof value !== "string") problems.push(`env '${name}' is a string`);
    }
  else if (env !== undefined) problems.push("env is an object");

  return problems;
}

function withEnvironment<T>(values: Record<string, string | undefined>, run: () => Promise<T>) {
  const saved = Object.fromEntries(ENVIRONMENT_NAMES.map((name) => [name, process.env[name]]));

  const apply = (entries: Record<string, string | undefined>): void => {
    for (const [name, value] of Object.entries(entries))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  };

  apply(values);

  return run().finally(() => apply(saved));
}

function stateOutsideRoot(path: string, state: FileState, root: string): FileState {
  if (state.text?.includes(root))
    throw new Error(
      `cli case: the written file ${path} holds the run root ${root}, so its hash is not reproducible`,
    );

  return state;
}

function normalizedFiles(
  files: Record<string, FileState>,
  root: string,
): Record<string, FileState> {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([path, state]) => [path, stateOutsideRoot(path, state, root)]),
  );
}

function recordedFiles(calls: readonly RecordedCall[], root: string): ExpectedFiles {
  const files: ExpectedFiles = new Map();
  const counts = new Map<RecordedUnit, number>();

  for (const call of calls) {
    if (call.threw !== undefined)
      throw new Error(`cli case: the recorded call ${call.function} threw: ${call.threw}`);

    const position = (counts.get(call.unit) ?? 0) + 1;
    const written = normalizedFiles(call.written, root);
    const recorded = {
      function: call.function,
      args: call.args,
      result: call.result,
      ...(Object.keys(written).length === 0 ? {} : { written }),
    };

    counts.set(call.unit, position);
    files.set(
      `${call.unit}/${String(position).padStart(2, "0")}-${call.function}.json`,
      jsonText(recorded).replaceAll(root, ROOT_TOKEN),
    );
  }

  return files;
}

/** The transcript and the recorded calls of one case. */
export async function cliFiles(
  tools: OracleTools,
  directory: string,
  spec: CliSpec,
): Promise<ExpectedFiles> {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "seampact-oracle-cli-"));

  try {
    cpSync(join(directory, TREE_DIRECTORY), root, { recursive: true, verbatimSymlinks: true });

    if (existsSync(join(directory, GIT_SOURCE_DIRECTORY)))
      buildGitSource(join(directory, GIT_SOURCE_DIRECTORY), root);

    return await runCase(tools, root, spec);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runCase(tools: OracleTools, root: string, spec: CliSpec): Promise<ExpectedFiles> {
  const skip = [GIT_SOURCE_REPOSITORY];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const environment = {
    SEAMPACT_CACHE_DIR: resolve(root, spec.env?.SEAMPACT_CACHE_DIR ?? DEFAULT_CACHE_DIRECTORY),
    SEAMPACT_ALLOW_LOCAL: spec.env?.SEAMPACT_ALLOW_LOCAL,
  };
  const before = snapshotTree(root, skip);
  const io = {
    cwd: resolve(root, spec.cwd ?? "."),
    stdout: (text: string) => stdout.push(text),
    stderr: (text: string) => stderr.push(text),
    today: () => FIXED_TODAY,
  };
  const argv = spec.argv.map((argument) => argument.replaceAll(ROOT_TOKEN, root));
  const { value: exit, calls } = await withEnvironment(environment, () =>
    recordCalls(root, () => tools.runCli(argv, io)),
  );
  const after = snapshotTree(root, skip);
  const transcript = {
    exit,
    stdout: stdout.join("").replaceAll(root, ROOT_TOKEN),
    stderr: stderr.join("").replaceAll(root, ROOT_TOKEN),
    written: normalizedFiles(writtenBetween(before, after), root),
    removed: [...before.keys()].filter((path) => !after.has(path)).sort(),
  };

  const replayable = calls.filter(
    (call) => !(call.unit === "cli-config" && spec.argv[0] === CONFIG_WRITING_COMMAND),
  );

  return new Map([
    ["cli/transcript.json", jsonText(transcript)],
    ...recordedFiles(replayable, root),
  ]);
}
