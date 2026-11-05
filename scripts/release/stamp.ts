// Writes the release version into every version field of the repository: run once on the release branch, then commit.
//   node scripts/release/stamp.ts <version> [--root <dir>]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "./release-cli.ts";
import { releaseVersion } from "./release-version.ts";
import { releaseVersionEdits } from "./version-plan.ts";

const USAGE = "node scripts/release/stamp.ts <version> [--root <dir>]";

await runReleaseCommand("stamp", () => {
  const { values, positionals } = parsedArguments(ROOT_OPTION, USAGE);
  const root = repositoryRoot(values.root);
  const version = releaseVersion(positionals[0]);
  const edits = releaseVersionEdits(root, version).filter((edit) => edit.changes.length > 0);

  for (const edit of edits) writeFileSync(join(root, edit.file), edit.after);

  console.log(`stamp: ${edits.length} file(s) written at ${version}`);
});
