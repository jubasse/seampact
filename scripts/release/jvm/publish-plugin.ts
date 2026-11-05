// The Gradle Plugin Portal publish of publish-plugin-portal, after plugin-portal-plan.ts found the portal's repository
// without the version: `publishPlugins`, run by build-plugin.sh with the portal key of the environment
// (`GRADLE_PUBLISH_KEY`, `GRADLE_PUBLISH_SECRET`). A rerun while the portal still reviews the plugin finds its
// repository without the version too, and the portal refuses the second upload as already existing: that answer
// counts as published, named by a warning annotation the release reviewer sees. Only the portal's own answer, the
// text Gradle prints after "Server responded with:", is read, and it must name the plugin id and, before "already
// exists", the version, both as whole tokens. Any other failure fails the job.
//   node scripts/release/jvm/publish-plugin.ts <assets-dir> --version <version>
import { spawn } from "node:child_process";
import { join } from "node:path";
import { parsedArguments, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError, releaseVersion } from "../release-version.ts";
import { GRADLE_PLUGIN_ID } from "./jvm-release.ts";

const USAGE = "publish-plugin.ts <assets-dir> --version <version>";
const BUILD_PLUGIN_SCRIPT = join(import.meta.dirname, "build-plugin.sh");
const SERVER_ANSWER_PREFIX = "Server responded with:";
const ALREADY_EXISTS = /already exists/i;

export type PluginPublishOutcome = "published" | "already-exists";

/**
 * What the run of `publishPlugins` means for the version: published, or held by the portal already (its answer then
 * names the plugin and, before "already exists", the version); throws on any other failure.
 */
export function pluginPublishOutcome(
  exitCode: number,
  output: string,
  version: string,
): PluginPublishOutcome {
  if (exitCode === 0) return "published";

  const alreadyExists = portalAnswers(output).some((answer) =>
    answersVersionAlreadyExists(answer, version),
  );

  if (alreadyExists) return "already-exists";

  throw new ReleaseError(
    `publishPlugins failed with exit code ${exitCode} (Gradle's output above), and the portal did not answer that ${GRADLE_PLUGIN_ID} ${version} already exists`,
  );
}

/** The log line of the outcome; a warning annotation when the portal's answer is counted as published. */
export function pluginPublishMessage(outcome: PluginPublishOutcome, version: string): string {
  if (outcome === "published") return `publish-plugin: ${GRADLE_PLUGIN_ID} ${version} published`;

  return `::warning title=Gradle plugin counted as published::the Plugin Portal answers that ${GRADLE_PLUGIN_ID} ${version} already exists (a rerun while it reviews the plugin): counted as published, check the plugin on plugins.gradle.org`;
}

// The text after each "Server responded with:" of Gradle's output: the portal's answer, not Gradle's own messages.
function portalAnswers(output: string): string[] {
  return output.split("\n").flatMap((line) => {
    const start = line.indexOf(SERVER_ANSWER_PREFIX);

    return start === -1 ? [] : [line.slice(start + SERVER_ANSWER_PREFIX.length)];
  });
}

// A taken plugin id names the version after "already exists", so the version must come before it.
function answersVersionAlreadyExists(answer: string, version: string): boolean {
  const alreadyExists = ALREADY_EXISTS.exec(answer);

  if (alreadyExists === null) return false;

  return (
    holdsWholeToken(answer, GRADLE_PLUGIN_ID) &&
    holdsWholeToken(answer.slice(0, alreadyExists.index), version)
  );
}

const TOKEN_CHARACTER = /[\w.-]/;

// No letter, digit, dot or dash on either side: 1.0.0 is no token of 11.0.0, nor the id of a longer id.
function holdsWholeToken(text: string, token: string): boolean {
  for (let start = text.indexOf(token); start !== -1; start = text.indexOf(token, start + 1)) {
    const before = text.charAt(start - 1);
    const after = text.charAt(start + token.length);

    if (!TOKEN_CHARACTER.test(before) && !TOKEN_CHARACTER.test(after)) return true;
  }

  return false;
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

    console.log(pluginPublishMessage(pluginPublishOutcome(exitCode, output, version), version));
  });
