// The seampact command line: `runCli`, its commands, and the app config reader they share.

export { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, EXIT_USAGE } from "./cli-io.js";
export { type CliProblem, formatProblem } from "./cli-problem.js";
export { runCli } from "./run-cli.js";

export const PACKAGE_NAME = "@seampact/cli";
