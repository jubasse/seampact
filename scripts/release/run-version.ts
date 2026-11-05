// The version check of a release run, before anything is built: a release form, and not the development version
// in a real run. Prints the version.
//   node scripts/release/run-version.ts <version> --mode real|dry-run
import { parsedArguments, runReleaseCommand } from "./release-cli.ts";
import { ReleaseError, RUN_MODES, type RunMode, runVersion } from "./release-version.ts";

const USAGE = `node scripts/release/run-version.ts <version> --mode ${RUN_MODES.join("|")}`;

const isRunMode = (candidate: string | undefined): candidate is RunMode =>
  RUN_MODES.some((mode) => mode === candidate);

await runReleaseCommand("run-version", () => {
  const { values, positionals } = parsedArguments({ mode: { type: "string" } }, USAGE);

  if (!isRunMode(values.mode))
    throw new ReleaseError(`--mode is ${RUN_MODES.join(" or ")}; usage: ${USAGE}`);

  console.log(runVersion(positionals[0], values.mode));
});
