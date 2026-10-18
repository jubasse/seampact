import { type CliProblem, formatProblem } from "./cli-problem.js";

// What a command reads and writes besides files: the working directory and the two output streams.
export interface CliIo {
  cwd: string;
  stdout(text: string): void;
  stderr(text: string): void;
}

export const EXIT_SUCCESS = 0;
export const EXIT_REFUSED = 1;
export const EXIT_USAGE = 2;

export function printProblems(io: CliIo, problems: readonly CliProblem[]): void {
  for (const problem of problems) io.stderr(`${formatProblem(problem)}\n`);
}
