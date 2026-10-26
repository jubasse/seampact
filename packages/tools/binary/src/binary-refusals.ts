import type { CliProblem } from "@seampact/cli";

const NPM_CLI = "with the npm CLI, which loads npm targets";
// The npm CLI refuses a Maven or Composer entry in turn, so an app that mixes both has no runner for its documents.
const MIXED_APP_FIX =
  "An app config that mixes npm entries with Maven or Composer ones sets `openapi: none`, or is split into one app config per runner.";

// The commands the binary runs only on an app config whose target entries are all native (a Maven coordinate or a
// Composer package), with the problem it prints for an npm entry: it holds no codegen target and no npm package
// loader, so it writes or checks the documents and pinned bundles and leaves the native entries to their build
// plugin (ADR 0010).
export const BINARY_NATIVE_ONLY_COMMANDS: ReadonlyMap<string, CliProblem> = new Map([
  [
    "generate",
    {
      code: "binary.generate-unavailable",
      message:
        "The standalone binary carries no codegen target, so it cannot generate an npm target entry.",
      fix: `Run \`seampact generate\` ${NPM_CLI}, or leave the entry to a Gradle, Maven or Composer plugin's own target. ${MIXED_APP_FIX}`,
    },
  ],
  [
    "check",
    {
      code: "binary.check-unavailable",
      message:
        "The standalone binary carries no codegen target, so it cannot check the files of an npm target entry.",
      fix: `Run \`seampact check\` ${NPM_CLI}, or leave the entry to a Gradle, Maven or Composer plugin's own target. ${MIXED_APP_FIX}`,
    },
  ],
]);
