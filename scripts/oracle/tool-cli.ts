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
import {
  type CliStep,
  type CommandStep,
  applyTreeStep,
  cliStepsProblems,
  isCommandStep,
  stepCwd,
} from "./cli-steps.ts";
import { type ExpectedFiles, jsonText } from "./expected-text.ts";
import { buildGitSource, GIT_SOURCE_DIRECTORY, GIT_SOURCE_REPOSITORY } from "./git-source.ts";
import { linkProbeGenerators } from "./probe-generators.ts";
import type { OracleTools } from "./tool-modules.ts";

// A CLI case: the command runs on a fresh copy of `tree/` (and the bare repository of `git-source/`), and the case
// keeps its transcript (`cli/transcript.json`) and the calls it made to the config readers, the editor schemas and
// the bundle fetch (`<unit>/<NN>-<function>.json`). A case of the `steps` form runs several commands and tree edits
// on one root and keeps one transcript per command (`cli/<NN>-transcript.json`).

// `init` writes the config and the contract its own run then reads: replaying a read on the tree before the command
// cannot match.
const CONFIG_WRITING_COMMAND = "init";
const CONFIG_AND_CONTRACT_UNITS: readonly RecordedUnit[] = ["cli-config", "bundle-fetch"];

interface CliEnvironment {
  SEAMPACT_CACHE_DIR?: string;
  SEAMPACT_ALLOW_LOCAL?: string;
}

export type CliSpec =
  | { argv: string[]; cwd?: string; env?: CliEnvironment }
  | { steps: CliStep[]; env?: CliEnvironment };

export const ROOT_TOKEN = "<root>";
export const FIXED_TODAY = "2026-01-01";
const TREE_DIRECTORY = "tree";
const DEFAULT_CACHE_DIRECTORY = ".cache";
const ENVIRONMENT_NAMES = ["SEAMPACT_CACHE_DIR", "SEAMPACT_ALLOW_LOCAL"] as const;

export function cliSpecProblems(spec: unknown): string[] {
  if (typeof spec !== "object" || spec === null) return ["cli.json is an object"];

  const { argv, cwd, env, steps, ...rest } = spec as Record<string, unknown>;
  const problems: string[] = [];

  if (steps !== undefined) {
    if (argv !== undefined || cwd !== undefined)
      problems.push("steps goes without argv and cwd (each step holds its own)");

    problems.push(...cliStepsProblems(steps));
  } else {
    if (!Array.isArray(argv) || !argv.every((item) => typeof item === "string"))
      problems.push("argv is an array of strings");

    if (cwd !== undefined && typeof cwd !== "string") problems.push("cwd is a string");
  }

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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// A `compileWorkspaceWithImports` result holds each api's IR and source map as the compiler built them, members in
// construction order; they are written as the compile oracle writes them: members in UTF-16 order.
function withCanonicalIrs(tools: OracleTools, result: unknown): unknown {
  if (!isObject(result) || !isObject(result.compiled) || !Array.isArray(result.compiled.apis))
    return result;

  const canonical = (value: unknown): unknown =>
    value === undefined ? undefined : JSON.parse(tools.finalizeSerializeJson(value));
  const apis = result.compiled.apis.map((api: unknown) =>
    isObject(api)
      ? {
          ...api,
          ...(api.ir === undefined ? {} : { ir: canonical(api.ir) }),
          ...(api.sourceMap === undefined ? {} : { sourceMap: canonical(api.sourceMap) }),
        }
      : api,
  );

  return { ...result, compiled: { ...result.compiled, apis } };
}

interface StepCall {
  call: RecordedCall;
  /** The position among the `argv` steps; set for a case of the `steps` form. */
  step?: number;
}

function recordedFiles(
  tools: OracleTools,
  calls: readonly StepCall[],
  root: string,
): ExpectedFiles {
  const files: ExpectedFiles = new Map();
  const counts = new Map<RecordedUnit, number>();

  for (const { call, step } of calls) {
    if (call.threw !== undefined)
      throw new Error(`cli case: the recorded call ${call.function} threw: ${call.threw}`);

    const position = (counts.get(call.unit) ?? 0) + 1;
    const written = normalizedFiles(call.written, root);
    const recorded = {
      function: call.function,
      args: call.args,
      result: withCanonicalIrs(tools, call.result),
      ...(Object.keys(written).length === 0 ? {} : { written }),
      ...(step === undefined ? {} : { step }),
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

interface CommandRun {
  transcript: object;
  calls: RecordedCall[];
}

async function runCommand(
  tools: OracleTools,
  root: string,
  step: CommandStep,
  env: CliEnvironment | undefined,
  skip: readonly string[],
): Promise<CommandRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const environment = {
    SEAMPACT_CACHE_DIR: resolve(root, env?.SEAMPACT_CACHE_DIR ?? DEFAULT_CACHE_DIRECTORY),
    SEAMPACT_ALLOW_LOCAL: env?.SEAMPACT_ALLOW_LOCAL,
  };
  const before = snapshotTree(root, skip);
  const io = {
    cwd: stepCwd(root, step),
    stdout: (text: string) => stdout.push(text),
    stderr: (text: string) => stderr.push(text),
    today: () => FIXED_TODAY,
  };
  const argv = step.argv.map((argument) => argument.replaceAll(ROOT_TOKEN, root));
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

  return {
    transcript,
    calls: calls.filter(
      (call) =>
        !(CONFIG_AND_CONTRACT_UNITS.includes(call.unit) && step.argv[0] === CONFIG_WRITING_COMMAND),
    ),
  };
}

const stepsOf = (spec: CliSpec): CliStep[] =>
  "steps" in spec
    ? spec.steps
    : [{ argv: spec.argv, ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }) }];

async function runCase(tools: OracleTools, root: string, spec: CliSpec): Promise<ExpectedFiles> {
  const skip = [GIT_SOURCE_REPOSITORY, ...linkProbeGenerators(tools, root)];
  const isStepsCase = "steps" in spec;
  const files: ExpectedFiles = new Map();
  const calls: StepCall[] = [];
  let commands = 0;

  for (const step of stepsOf(spec)) {
    if (!isCommandStep(step)) {
      applyTreeStep(root, step);

      continue;
    }

    commands += 1;

    const run = await runCommand(tools, root, step, spec.env, skip);
    const name = isStepsCase ? `${String(commands).padStart(2, "0")}-transcript` : "transcript";

    files.set(`cli/${name}.json`, jsonText(run.transcript));
    calls.push(...run.calls.map((call) => ({ call, ...(isStepsCase ? { step: commands } : {}) })));
  }

  for (const [path, text] of recordedFiles(tools, calls, root)) files.set(path, text);

  return files;
}
