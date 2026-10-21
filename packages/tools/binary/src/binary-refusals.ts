import { type CliProblem, EXIT_USAGE } from "@seampact/cli";

// Commands the binary does not carry: it holds no codegen target and no npm package loader (ADR 0010).
const REFUSED_COMMANDS: ReadonlyMap<string, CliProblem> = new Map([
  [
    "generate",
    {
      code: "binary.generate-unavailable",
      message: "The standalone binary carries no codegen target, so it cannot run `generate`.",
      fix: "Run `seampact generate` with the npm CLI, or generate with the ecosystem plugin (Gradle, Maven or Composer).",
    },
  ],
]);

export const BINARY_REFUSAL_EXIT_CODE = EXIT_USAGE;

// The problem to print when `argv` starts a command the binary does not carry.
export function binaryRefusal(argv: readonly string[]): CliProblem | undefined {
  const [command] = argv;

  return command === undefined ? undefined : REFUSED_COMMANDS.get(command);
}
