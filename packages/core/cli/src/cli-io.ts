import { type CliProblem, formatProblem } from "./cli-problem.js";

// What a command reads and writes besides files: the working directory and the two output streams.
export interface CliIo {
  cwd: string;
  stdout(text: string): void;
  stderr(text: string): void;
  // Today as `YYYY-MM-DD`, the diff's only time input; the system date when absent.
  today?(): string;
}

export const EXIT_SUCCESS = 0;
export const EXIT_REFUSED = 1;
export const EXIT_USAGE = 2;

export function printProblems(io: CliIo, problems: readonly CliProblem[]): void {
  for (const problem of problems) io.stderr(`${formatProblem(problem)}\n`);
}

// A warning names what the generated files leave to the developer's code; the command goes on.
export function printWarnings(io: CliIo, warnings: readonly CliProblem[]): void {
  for (const warning of warnings) io.stderr(`warning: ${formatProblem(warning)}\n`);
}
