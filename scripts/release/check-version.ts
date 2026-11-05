// The version check of a release: every version field of the checkout is at the release version, as the stamp
// writes it.
//   node scripts/release/check-version.ts <version> [--root <dir>]
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "./release-cli.ts";
import { ReleaseError, releaseVersion } from "./release-version.ts";
import { pendingVersionChanges, releaseVersionEdits } from "./version-plan.ts";

const USAGE = "node scripts/release/check-version.ts <version> [--root <dir>]";

await runReleaseCommand("check-version", () => {
  const { values, positionals } = parsedArguments(ROOT_OPTION, USAGE);
  const version = releaseVersion(positionals[0]);
  const pending = pendingVersionChanges(releaseVersionEdits(repositoryRoot(values.root), version));

  if (pending.length > 0)
    throw new ReleaseError(
      `the checkout is not at ${version}:\n  ${pending.join("\n  ")}\n` +
        `run \`node scripts/release/stamp.ts ${version}\` on the release branch and commit the result`,
    );

  console.log(`check-version: every version field is at ${version}`);
});
