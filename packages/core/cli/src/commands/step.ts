import type { CliProblem } from "../cli-problem.js";

// A planning step that is done with a value, or refused with the problems to print.
export type Step<Value> =
  | { status: "done"; value: Value }
  | { status: "refused"; problems: CliProblem[] };
