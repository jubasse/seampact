import type { LoadReader } from "@seampact/compiler";
import { type CliProblem, formatProblem } from "./cli-problem.js";

// What a command reads and writes besides files: the working directory and the two output streams.
export interface CliIo {
  cwd: string;
  stdout(text: string): void;
  stderr(text: string): void;
  // Today as `YYYY-MM-DD`, the diff's only time input; the system date when absent.
  today?(): string;
  // The reader a contract source is loaded through, given the source directory; the file system when absent. The
  // standalone binary sets it to serve its embedded first-party packs when none is installed (ADR 0010).
  sourceReader?(directory: string): LoadReader;
  // The name to print for a file a diagnostic locates, given the path the compiler read it at; the path itself when
  // absent. The standalone binary names the first-party packs it embeds, which do not exist on disk.
  diagnosticFileLabel?(file: string): string;
  // Commands the host runs only on configs whose target entries are all native (a Maven coordinate or a Composer
  // package), by name, with the problem to print for an npm entry: the host loads no npm target, writes or checks the
  // documents and pinned bundles, and leaves each native entry to its build plugin. The standalone binary sets
  // `generate` and `check` (ADR 0010).
  nativeOnlyCommands?: ReadonlyMap<string, CliProblem>;
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
