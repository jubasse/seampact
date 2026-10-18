import { spawnSync } from "node:child_process";

export interface StepCommand {
  readonly title: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export class StepFailure extends Error {
  readonly exitCode: number;

  constructor(title: string, exitCode: number) {
    super(`consumers: '${title}' failed with exit code ${exitCode}`);
    this.exitCode = exitCode;
  }
}

const EXIT_NOT_STARTED = 1;

// Prints the step, runs it with the output shown, and throws a `StepFailure` carrying its exit code.
export function runStep(step: StepCommand): void {
  console.log(`\n> ${step.title}: ${[step.command, ...step.args].join(" ")} (in ${step.cwd})`);

  const result = spawnSync(step.command, step.args, { cwd: step.cwd, stdio: "inherit" });

  if (result.error !== undefined) {
    console.error(`consumers: '${step.title}' did not start: ${result.error.message}`);

    throw new StepFailure(step.title, EXIT_NOT_STARTED);
  }

  if (result.status !== 0) throw new StepFailure(step.title, result.status ?? EXIT_NOT_STARTED);
}

// A step done in this process, printed like a command.
export function runLocalStep(title: string, action: () => void): void {
  console.log(`\n> ${title}`);
  action();
}
