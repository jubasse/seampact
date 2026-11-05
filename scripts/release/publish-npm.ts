// The idempotent npm publish of the packed tarballs: each version the registry lacks is published; one it holds with
// the same bytes is skipped; one it holds with other bytes fails by name before anything is published, since a
// published version never changes. A failed run can so be rerun as is.
//   node scripts/release/publish-npm.ts <tarball-dir> --registry <url> [--provenance]
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parsedArguments, runReleaseCommand } from "./release-cli.ts";
import { ReleaseError } from "./release-version.ts";

const TARBALL_SUFFIX = ".tgz";
const HTTP_NOT_FOUND = 404;
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

export interface Tarball {
  readonly file: string;
  readonly name: string;
  readonly version: string;
  /** The Subresource Integrity string npm stores as `dist.integrity`: `sha512-<base64>` of the tarball's bytes. */
  readonly integrity: string;
}

export interface PublishPlan {
  readonly toPublish: readonly Tarball[];
  readonly alreadyPublished: readonly Tarball[];
}

export function packedTarballs(directory: string): Tarball[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(TARBALL_SUFFIX))
    .sort()
    .map((file) => tarballOf(join(directory, file)));
}

function tarballOf(file: string): Tarball {
  const manifest = JSON.parse(
    execFileSync("tar", ["-xzOf", file, "package/package.json"], { encoding: "utf8" }),
  );
  const integrity = `sha512-${createHash("sha512").update(readFileSync(file)).digest("base64")}`;

  return { file, name: String(manifest.name), version: String(manifest.version), integrity };
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
      `${conflicts.join("; ")}: a published version never changes, so nothing was published; release a new version`,
    );

  return { toPublish, alreadyPublished };
}

async function publishedIntegrity(registry: string, tarball: Tarball): Promise<string | undefined> {
  const url = `${registry.replace(/\/+$/, "")}/${tarball.name.replace("/", "%2f")}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });

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

// The version's integrity, `undefined` when the version is absent, `null` when it is listed without one.
function versionIntegrity(packument: unknown, version: string): string | undefined | null {
  const versions = isRecord(packument) ? packument.versions : undefined;
  const listed = isRecord(versions) ? versions[version] : undefined;

  if (listed === undefined) return undefined;

  const dist = isRecord(listed) ? listed.dist : undefined;
  const integrity = isRecord(dist) ? dist.integrity : undefined;

  return typeof integrity === "string" ? integrity : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

if (import.meta.main)
  await runReleaseCommand("publish-npm", async () => {
    const usage =
      "node scripts/release/publish-npm.ts <tarball-dir> --registry <url> [--provenance]";
    const { values, positionals } = parsedArguments(
      { registry: { type: "string" }, provenance: { type: "boolean" } },
      usage,
    );
    const directory = positionals[0];

    if (directory === undefined || values.registry === undefined)
      throw new ReleaseError(`the tarball directory and --registry are required; usage: ${usage}`);

    const tarballs = packedTarballs(resolve(directory));

    if (tarballs.length === 0)
      throw new ReleaseError(`${directory} holds no ${TARBALL_SUFFIX} tarball`);

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
