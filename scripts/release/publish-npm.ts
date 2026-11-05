// The idempotent npm publish of the packed tarballs: exactly the ones pack-npm's manifest lists, checked against it
// and against the packages of the release. Each version the registry lacks is published; one it holds with the same
// bytes is skipped; one it holds with other bytes fails by name before anything is published, since a published
// version never changes. A failed run can so be rerun as is.
//   node scripts/release/publish-npm.ts <tarball-dir> --manifest <file> --version <version> --registry <url>
//     [--provenance] [--root <dir>]
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isJsonRecord } from "./json-record.ts";
import { publishedPackageNames } from "./npm-versions.ts";
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "./release-cli.ts";
import { ReleaseError, releaseVersion } from "./release-version.ts";
import { manifestTarballs, parsedTarballManifest, type Tarball } from "./tarball-manifest.ts";

const HTTP_NOT_FOUND = 404;
// A registry that does not answer within this time fails the job instead of holding it to its timeout.
const REGISTRY_TIMEOUT_MILLISECONDS = 30_000;
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

export interface PublishPlan {
  readonly toPublish: readonly Tarball[];
  readonly alreadyPublished: readonly Tarball[];
}

/** Asks the registry for each version; throws a `ReleaseError` naming every version held with other bytes. */
export async function publishPlan(
  registry: string,
  tarballs: readonly Tarball[],
): Promise<PublishPlan> {
  const toPublish: Tarball[] = [];
  const alreadyPublished: Tarball[] = [];
  const conflicts: string[] = [];

  for (const tarball of tarballs) {
    const published = await publishedIntegrity(registry, tarball);

    if (published === undefined) toPublish.push(tarball);
    else if (published === tarball.integrity) alreadyPublished.push(tarball);
    else
      conflicts.push(
        `${tarball.name}@${tarball.version} is on ${registry} with other bytes (${published}, this tarball is ` +
          `${tarball.integrity})`,
      );
  }

  if (conflicts.length > 0)
    throw new ReleaseError(
      `${conflicts.join("; ")}: a published version never changes, so nothing was published; stamp and release a ` +
        "new patch version",
    );

  return { toPublish, alreadyPublished };
}

async function publishedIntegrity(registry: string, tarball: Tarball): Promise<string | undefined> {
  const url = `${registry.replace(/\/+$/, "")}/${tarball.name.replace("/", "%2f")}`;
  const response = await fetchPackument(url, tarball.name);

  if (response.status === HTTP_NOT_FOUND) return undefined;

  if (!response.ok)
    throw new ReleaseError(
      `${url} answered ${response.status}: the registry cannot say whether ${tarball.name} is published`,
    );

  const packument: unknown = await response.json();
  const integrity = versionIntegrity(packument, tarball.version);

  if (integrity === null)
    throw new ReleaseError(
      `${url} lists ${tarball.name}@${tarball.version} without a \`dist.integrity\``,
    );

  return integrity;
}

async function fetchPackument(url: string, name: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MILLISECONDS),
    });
  } catch (error) {
    throw new ReleaseError(
      `${url} did not answer (${error instanceof Error ? error.message : String(error)}): the registry cannot say ` +
        `whether ${name} is published; rerun once it answers`,
    );
  }
}

// The version's integrity, `undefined` when the version is absent, `null` when it is listed without one.
function versionIntegrity(packument: unknown, version: string): string | undefined | null {
  const versions = isJsonRecord(packument) ? packument.versions : undefined;
  const listed = isJsonRecord(versions) ? versions[version] : undefined;

  if (listed === undefined) return undefined;

  const dist = isJsonRecord(listed) ? listed.dist : undefined;
  const integrity = isJsonRecord(dist) ? dist.integrity : undefined;

  return typeof integrity === "string" ? integrity : null;
}

function publish(registry: string, tarball: Tarball, extraArguments: readonly string[]): void {
  const args = [
    "publish",
    tarball.file,
    "--access",
    "public",
    "--registry",
    registry,
    ...extraArguments,
  ];

  console.log(`\n> ${NPM} ${args.join(" ")}`);

  const result = spawnSync(NPM, args, { stdio: "inherit" });

  if (result.status !== 0)
    throw new ReleaseError(
      `npm publish of ${tarball.name}@${tarball.version} failed (${result.error?.message ?? `exit ${result.status}`}); ` +
        "the versions published before it stay, and a rerun skips them",
    );
}

const USAGE =
  "node scripts/release/publish-npm.ts <tarball-dir> --manifest <file> --version <version> --registry <url> " +
  "[--provenance] [--root <dir>]";

if (import.meta.main)
  await runReleaseCommand("publish-npm", async () => {
    const { values, positionals } = parsedArguments(
      {
        ...ROOT_OPTION,
        manifest: { type: "string" },
        version: { type: "string" },
        registry: { type: "string" },
        provenance: { type: "boolean" },
      },
      USAGE,
    );
    const directory = positionals[0];

    if (directory === undefined || values.registry === undefined || values.manifest === undefined)
      throw new ReleaseError(
        `the tarball directory, --manifest and --registry are required; usage: ${USAGE}`,
      );

    const version = releaseVersion(values.version);
    const manifest = parsedTarballManifest(readFileSync(values.manifest, "utf8"), values.manifest);
    const tarballs = manifestTarballs(resolve(directory), manifest, {
      version,
      names: publishedPackageNames(repositoryRoot(values.root)),
    });
    const plan = await publishPlan(values.registry, tarballs);

    for (const tarball of plan.alreadyPublished)
      console.log(
        `publish-npm: ${tarball.name}@${tarball.version} is already published with these bytes, skipped`,
      );

    const extraArguments = values.provenance === true ? ["--provenance"] : [];

    for (const tarball of plan.toPublish) publish(values.registry, tarball, extraArguments);

    console.log(
      `publish-npm: ${plan.toPublish.length} published, ${plan.alreadyPublished.length} already there, on ${values.registry}`,
    );
  });
