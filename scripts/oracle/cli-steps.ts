import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

// The `steps` form of `cli.json`: commands and tree edits run in order on one root (README, "Generate and check
// cases"). A `write` or `remove` step changes the root between two commands, so a later command reads the edit.

export interface CommandStep {
  argv: string[];
  cwd?: string;
}

export interface WriteStep {
  write: Record<string, string>;
}

export interface RemoveStep {
  remove: string[];
}

export type CliStep = CommandStep | WriteStep | RemoveStep;

export const isCommandStep = (step: CliStep): step is CommandStep => "argv" in step;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function stepProblems(step: unknown, position: number): string[] {
  const where = `steps[${position}]`;

  if (!isRecord(step)) return [`${where} is an object`];

  const { argv, cwd, write, remove, ...rest } = step;
  const forms = [argv, write, remove].filter((form) => form !== undefined).length;
  const problems = Object.keys(rest).map((name) => `${where} has no '${name}' member`);

  if (forms !== 1) problems.push(`${where} holds exactly one of argv, write and remove`);

  if (argv !== undefined && !isStringList(argv))
    problems.push(`${where}.argv is an array of strings`);

  if (cwd !== undefined && (typeof cwd !== "string" || argv === undefined))
    problems.push(`${where}.cwd is a string, and goes with argv`);

  if (
    write !== undefined &&
    !(isRecord(write) && Object.values(write).every((text) => typeof text === "string"))
  )
    problems.push(`${where}.write maps paths to texts`);

  if (remove !== undefined && !isStringList(remove))
    problems.push(`${where}.remove is an array of paths`);

  return problems;
}

/** The problems of a `steps` member, empty when it is valid. */
export function cliStepsProblems(steps: unknown): string[] {
  if (!Array.isArray(steps)) return ["steps is an array"];

  const problems = steps.flatMap((step: unknown, position) => stepProblems(step, position));

  if (!steps.some((step: unknown) => isRecord(step) && "argv" in step))
    problems.push("steps holds at least one argv step");

  return problems;
}

function pathInside(root: string, path: string): string {
  const resolved = resolve(root, path);
  const outside = relative(root, resolved).startsWith("..") || isAbsolute(relative(root, resolved));

  if (outside || resolved === root)
    throw new Error(`cli case: the step path '${path}' is not a path under the root`);

  return resolved;
}

/** Runs a `write` or `remove` step on `root`. */
export function applyTreeStep(root: string, step: WriteStep | RemoveStep): void {
  if ("write" in step) {
    for (const [path, text] of Object.entries(step.write)) {
      const file = pathInside(root, path);

      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }

    return;
  }

  for (const path of step.remove) {
    const target = pathInside(root, path);

    if (!existsSync(target)) throw new Error(`cli case: the remove step path '${path}' is absent`);

    rmSync(target, { recursive: true });
  }
}

export const stepCwd = (root: string, step: CommandStep): string => join(root, step.cwd ?? ".");
