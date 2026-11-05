// The wait of publish-plugin-portal before `publishPlugins`: the job starts beside publish-maven-central, under the
// same approval, so the seampact modules the Gradle plugin depends on may not be on Maven Central yet. It reads the
// rebuilt plugin's POM, then polls repo1 until it serves the POM and jar of each seampact dependency at the version,
// those of their own seampact dependencies included, and fails by name once the time is up.
//   node scripts/release/jvm/central-wait.ts --version <version> [--repository <url>] [--timeout-minutes <n>]
//     [--root <dir>]
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError, releaseVersion } from "../release-version.ts";
import { block } from "./bundle-layout.ts";
import { CENTRAL_REPOSITORY_URL } from "./central-portal.ts";
import {
  type Coordinate,
  GRADLE_PLUGIN_MODULE,
  JVM_GROUP,
  versionDirectory,
} from "./jvm-release.ts";
import { pluginBuildOutputs } from "./plugin-portal-plan.ts";

const HTTP_NOT_FOUND = 404;
const REQUEST_TIMEOUT_MILLISECONDS = 60_000;
const DEFAULT_TIMEOUT_MINUTES = 120;
const POLL_INTERVAL_MILLISECONDS = 60_000;
const MILLISECONDS_PER_MINUTE = 60_000;

export interface CentralWait {
  readonly repository: string;
  readonly version: string;
  readonly pollIntervalMilliseconds: number;
  readonly timeoutMilliseconds: number;
}

/**
 * The seampact modules a POM depends on, read from its `<dependencies>` (not its `<dependencyManagement>`); throws
 * on one at another version, since every seampact module is released at one version.
 */
export function seampactDependencies(pom: string, version: string, pomName: string): Coordinate[] {
  const dependencies = pom.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, "");
  const coordinates: Coordinate[] = [];

  for (const [dependency] of dependencies.matchAll(/<dependency>[\s\S]*?<\/dependency>/g)) {
    if (block(dependency, "groupId") !== JVM_GROUP) continue;

    const artifactId = block(dependency, "artifactId");
    const dependencyVersion = block(dependency, "version");

    if (dependencyVersion !== version)
      throw new ReleaseError(
        `${pomName} depends on ${JVM_GROUP}:${artifactId}:${dependencyVersion}, not on the release version ${version}`,
      );

    coordinates.push({ group: JVM_GROUP, artifactId });
  }

  return coordinates;
}

/** Waits until the repository serves the POM and jar of each module and of its seampact dependencies. */
export async function waitForCentralModules(
  wait: CentralWait,
  modules: readonly Coordinate[],
): Promise<string[]> {
  const deadline = Date.now() + wait.timeoutMilliseconds;
  const queue = [...modules];
  const served: string[] = [];

  for (let module = queue.shift(); module !== undefined; module = queue.shift()) {
    if (served.includes(module.artifactId)) continue;

    const pom = await waitForFile(wait, deadline, filePath(module, wait.version, "pom"));

    await waitForFile(wait, deadline, filePath(module, wait.version, "jar"));
    queue.push(
      ...seampactDependencies(pom, wait.version, `${module.artifactId}-${wait.version}.pom`),
    );
    served.push(module.artifactId);
  }

  return served;
}

function filePath(module: Coordinate, version: string, extension: string): string {
  return `${versionDirectory(module, version)}/${module.artifactId}-${version}.${extension}`;
}

async function waitForFile(wait: CentralWait, deadline: number, path: string): Promise<string> {
  const url = `${wait.repository.replace(/\/+$/, "")}/${path}`;

  for (;;) {
    const response = await timedGet(url);

    if (response.ok) return response.text();

    if (response.status !== HTTP_NOT_FOUND)
      throw new ReleaseError(
        `${url} answered ${response.status}: rerun the job once the repository answers`,
      );

    if (Date.now() >= deadline)
      throw new ReleaseError(
        `${url} is still not served after ${wait.timeoutMilliseconds / MILLISECONDS_PER_MINUTE} minutes, and the Gradle plugin depends on it: ` +
          "check publish-maven-central, then rerun this job once Central serves it; nothing was published to the Plugin Portal",
      );

    await delay(wait.pollIntervalMilliseconds);
  }
}

async function timedGet(url: string): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS) });
  } catch (error) {
    throw new ReleaseError(
      `GET ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (import.meta.main)
  await runReleaseCommand("central-wait", async () => {
    const usage =
      "central-wait.ts --version <version> [--repository <url>] [--timeout-minutes <n>] [--root <dir>]";
    const { values } = parsedArguments(
      {
        ...ROOT_OPTION,
        version: { type: "string" },
        repository: { type: "string" },
        "timeout-minutes": { type: "string" },
      },
      usage,
    );
    const version = releaseVersion(values.version);
    const timeoutMinutes = Number(values["timeout-minutes"] ?? DEFAULT_TIMEOUT_MINUTES);

    if (!Number.isInteger(timeoutMinutes) || timeoutMinutes <= 0)
      throw new ReleaseError(
        `--timeout-minutes is a positive whole number, not ${values["timeout-minutes"]}`,
      );

    const pluginPom = [...pluginBuildOutputs(repositoryRoot(values.root), version)].find(([path]) =>
      path.endsWith(`/${GRADLE_PLUGIN_MODULE}-${version}.pom`),
    )?.[1];

    if (pluginPom === undefined)
      throw new ReleaseError("the plugin build outputs list no plugin POM");

    const pomName = `${GRADLE_PLUGIN_MODULE}-${version}.pom`;
    const dependencies = seampactDependencies(readFileSync(pluginPom, "utf8"), version, pomName);
    const served = await waitForCentralModules(
      {
        repository: values.repository ?? CENTRAL_REPOSITORY_URL,
        version,
        pollIntervalMilliseconds: POLL_INTERVAL_MILLISECONDS,
        timeoutMilliseconds: timeoutMinutes * MILLISECONDS_PER_MINUTE,
      },
      dependencies,
    );

    console.log(
      served.length === 0
        ? `central-wait: ${pomName} depends on no seampact module`
        : `central-wait: Central serves ${served.join(", ")} at ${version}`,
    );
  });
