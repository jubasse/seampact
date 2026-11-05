// The Gradle Plugin Portal publish of publish-plugin-portal, after plugin-portal-plan.ts found the portal's repository
// without the version: `publishPlugins`, run by build-plugin.sh with the portal key of the environment
// (`GRADLE_PUBLISH_KEY`, `GRADLE_PUBLISH_SECRET`). A rerun while the portal still reviews the plugin finds its
// repository without the version too, and the portal refuses the second upload as already existing: that answer
// counts as published, named in the log. Any other failure fails the job.
//   node scripts/release/jvm/publish-plugin.ts <assets-dir> --version <version>
import { spawn } from "node:child_process";
import { join } from "node:path";
import { parsedArguments, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError, releaseVersion } from "../release-version.ts";
import { GRADLE_PLUGIN_ID } from "./jvm-release.ts";

const USAGE = "publish-plugin.ts <assets-dir> --version <version>";
const BUILD_PLUGIN_SCRIPT = join(import.meta.dirname, "build-plugin.sh");
const ALREADY_EXISTS = /already exists/i;

export type PluginPublishOutcome = "published" | "already-exists";

/**
 * What the run of `publishPlugins` means for the version: published, or held by the portal already (its answer then
 * names the version); throws on any other failure.
 */
export function pluginPublishOutcome(
  exitCode: number,
  output: string,
  version: string,
): PluginPublishOutcome {
  if (exitCode === 0) return "published";

  const alreadyExists = output
    .split("\n")
    .some((line) => ALREADY_EXISTS.test(line) && line.includes(version));

  if (alreadyExists) return "already-exists";

  throw new ReleaseError(
    `publishPlugins failed with exit code ${exitCode} (Gradle's output above), and the portal did not answer that ${GRADLE_PLUGIN_ID} ${version} already exists`,
  );
}

// The output goes to the log as it comes and is kept for the outcome.
function runPublishPlugins(assetsDirectory: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(BUILD_PLUGIN_SCRIPT, [assetsDirectory, "publishPlugins"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";

    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      output += chunk.toString("utf8");
    });
    child.on("error", (error) =>
      reject(new ReleaseError(`${BUILD_PLUGIN_SCRIPT} could not start: ${error.message}`)),
    );
    child.on("close", (exitCode) => resolvePromise({ exitCode: exitCode ?? 1, output }));
  });
}

if (import.meta.main)
  await runReleaseCommand("publish-plugin", async () => {
    const { values, positionals } = parsedArguments({ version: { type: "string" } }, USAGE);
    const [assetsDirectory] = positionals;

    if (assetsDirectory === undefined) throw new ReleaseError(`usage: ${USAGE}`);

    const version = releaseVersion(values.version);
    const { exitCode, output } = await runPublishPlugins(assetsDirectory);
    const outcome = pluginPublishOutcome(exitCode, output, version);

    if (outcome === "already-exists")
      console.log(
        `publish-plugin: the portal answers that ${GRADLE_PLUGIN_ID} ${version} already exists (a rerun while it reviews the plugin): counted as published`,
      );
    else console.log(`publish-plugin: ${GRADLE_PLUGIN_ID} ${version} published`);
  });
