import type { CliProblem } from "@seampact/cli";

const NPM_CLI_OR_PLUGIN =
  "with the npm CLI, or with the ecosystem plugin (Gradle, Maven or Composer)";

// Commands the binary does not carry: it holds no codegen target and no npm package loader (ADR 0010).
export const BINARY_REFUSED_COMMANDS: ReadonlyMap<string, CliProblem> = new Map([
  [
    "generate",
    {
      code: "binary.generate-unavailable",
      message: "The standalone binary carries no codegen target, so it cannot run `generate`.",
      fix: `Run \`seampact generate\` ${NPM_CLI_OR_PLUGIN}.`,
    },
  ],
  [
    "check",
    {
      code: "binary.check-unavailable",
      message:
        "The standalone binary carries no codegen target, so it cannot check the generated files.",
      fix: `Run \`seampact check\` ${NPM_CLI_OR_PLUGIN}.`,
    },
  ],
]);
