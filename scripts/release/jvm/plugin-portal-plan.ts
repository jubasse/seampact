// The check publish-plugin-portal runs before `publishPlugins`, which builds and uploads the Gradle plugin itself:
// the files the job just built are byte for byte the ones of build-jvm's plugin-portal manifest (the build is
// reproducible), and the portal's repository is asked for the version. Prints `publish=true` when the portal lacks
// it, `publish=false` when it holds the same jar; fails by name when it holds other bytes, since a published version
// never changes.
//   node scripts/release/jvm/plugin-portal-plan.ts --manifest <file> --version <version> [--portal-repository <url>]
//     [--root <dir>]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError, releaseVersion } from "../release-version.ts";
import { isDerivedFile } from "./bundle-layout.ts";
import { type BundleManifestEntry, parsedBundleManifest, sha256Of } from "./bundle-manifest.ts";
import { expectedBundle, GRADLE_PLUGIN_MODULE, versionDirectory } from "./jvm-release.ts";

export const PLUGIN_PORTAL_REPOSITORY_URL = "https://plugins.gradle.org/m2";

const HTTP_NOT_FOUND = 404;
const REQUEST_TIMEOUT_MILLISECONDS = 60_000;
const PLUGIN_BUILD_DIRECTORY = `jvm/${GRADLE_PLUGIN_MODULE}/build`;
const PLUGIN_PUBLICATION = "publications/pluginMaven";
const MARKER_PUBLICATION = "publications/seampactPluginMarkerMaven";

/** The build output of the plugin module each published file comes from, by its path in the repository. */
export function pluginBuildOutputs(root: string, version: string): Map<string, string> {
  const [plugin, marker] = expectedBundle(root, "plugin-portal", version).coordinates;

  if (plugin === undefined || marker === undefined)
    throw new ReleaseError("the plugin-portal channel names no plugin and marker");

  const pluginDirectory = versionDirectory(plugin, version);
  const baseName = `${plugin.artifactId}-${version}`;
  const build = join(root, PLUGIN_BUILD_DIRECTORY);

  return new Map([
    [`${pluginDirectory}/${baseName}.jar`, join(build, "libs", `${baseName}.jar`)],
    [`${pluginDirectory}/${baseName}-sources.jar`, join(build, "libs", `${baseName}-sources.jar`)],
    [`${pluginDirectory}/${baseName}-javadoc.jar`, join(build, "libs", `${baseName}-javadoc.jar`)],
    [`${pluginDirectory}/${baseName}.pom`, join(build, PLUGIN_PUBLICATION, "pom-default.xml")],
    [`${pluginDirectory}/${baseName}.module`, join(build, PLUGIN_PUBLICATION, "module.json")],
    [
      `${versionDirectory(marker, version)}/${marker.artifactId}-${version}.pom`,
      join(build, MARKER_PUBLICATION, "pom-default.xml"),
    ],
  ]);
}

/** Every file of the manifest the build did not reproduce byte for byte; empty when it reproduced them all. */
export function rebuiltPluginProblems(
  root: string,
  version: string,
  manifest: readonly BundleManifestEntry[],
): string[] {
  const outputs = pluginBuildOutputs(root, version);
  const primaries = manifest.filter((entry) => !isDerivedFile(entry.path));
  const problems = [...outputs.keys()]
    .filter((path) => !primaries.some((entry) => entry.path === path))
    .map((path) => `${path} is not in the manifest`);

  for (const entry of primaries) {
    const output = outputs.get(entry.path);

    if (output === undefined)
      problems.push(`${entry.path} is in the manifest, but no plugin build output`);
    else if (!existsSync(output))
      problems.push(`${output} is missing: build the plugin before the check`);
    else if (sha256Of(readFileSync(output)) !== entry.sha256)
      problems.push(
        `${output} differs from the ${entry.path} build-jvm checked: the build is not reproducible`,
      );
  }

  return problems;
}

async function portalHoldsPlugin(
  repository: string,
  path: string,
  sha256: string,
): Promise<boolean> {
  const url = `${repository.replace(/\/+$/, "")}/${path}`;
  let response: Response;

  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS) });
  } catch (error) {
    throw new ReleaseError(
      `GET ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (response.status === HTTP_NOT_FOUND) return false;

  if (!response.ok)
    throw new ReleaseError(
      `${url} answered ${response.status}: the portal cannot say whether the plugin is published`,
    );

  if (sha256Of(new Uint8Array(await response.arrayBuffer())) === sha256) return true;

  throw new ReleaseError(
    `${url} is published with other bytes: a published version never changes, so nothing was published; stamp and release a new patch version`,
  );
}

if (import.meta.main)
  await runReleaseCommand("plugin-portal-plan", async () => {
    const usage =
      "plugin-portal-plan.ts --manifest <file> --version <version> [--portal-repository <url>]";
    const { values } = parsedArguments(
      {
        ...ROOT_OPTION,
        manifest: { type: "string" },
        version: { type: "string" },
        "portal-repository": { type: "string" },
      },
      usage,
    );

    if (values.manifest === undefined)
      throw new ReleaseError(`--manifest is required; usage: ${usage}`);

    const root = repositoryRoot(values.root);
    const version = releaseVersion(values.version);
    const manifest = parsedBundleManifest(readFileSync(values.manifest, "utf8"), values.manifest);
    const problems = rebuiltPluginProblems(root, version, manifest);

    if (problems.length > 0)
      throw new ReleaseError(
        `the plugin built here is not the one build-jvm checked, so nothing was published:\n  ${problems.join("\n  ")}`,
      );

    const [jar] = pluginBuildOutputs(root, version).keys();
    const jarEntry = manifest.find((entry) => entry.path === jar);

    if (jar === undefined || jarEntry === undefined)
      throw new ReleaseError("the manifest lists no plugin jar");

    const published = await portalHoldsPlugin(
      values["portal-repository"] ?? PLUGIN_PORTAL_REPOSITORY_URL,
      jar,
      jarEntry.sha256,
    );

    if (published)
      console.error(`plugin-portal-plan: ${jar} is already published with these bytes, skipped`);

    console.log(`publish=${!published}`);
  });
