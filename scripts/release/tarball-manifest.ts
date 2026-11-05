// The manifest of the packed tarballs: the file, name, version and SHA-256 of each, written by pack-npm and passed
// to the publish jobs as a job output, outside the artefact. A job that publishes takes exactly the tarballs it
// lists, each checked against its hash, and refuses any other file of the artefact, so bytes replaced in the
// artefact after pack-npm never reach a registry.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isJsonRecord } from "./json-record.ts";
import { ReleaseError } from "./release-version.ts";

export interface TarballManifestEntry {
  /** The file name in the tarball directory. */
  readonly file: string;
  readonly name: string;
  readonly version: string;
  readonly sha256: string;
}

/** What a release publishes: the names of its packages, each at its version. */
export interface ExpectedRelease {
  readonly version: string;
  readonly names: readonly string[];
}

export interface Tarball {
  /** The absolute path of the tarball. */
  readonly file: string;
  readonly name: string;
  readonly version: string;
  /** The Subresource Integrity string npm stores as `dist.integrity`: `sha512-<base64>` of the tarball's bytes. */
  readonly integrity: string;
}

const TARBALL_MANIFEST_FILE = "package/package.json";

export function tarballManifest(
  directory: string,
  files: readonly string[],
): TarballManifestEntry[] {
  return [...files].sort().map((file) => {
    const bytes = readFileSync(join(directory, file));
    const { name, version } = packedIdentity(join(directory, file));

    return { file, name, version, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
}

export function parsedTarballManifest(text: string, source: string): TarballManifestEntry[] {
  const refused = (problem: string) =>
    new ReleaseError(`${source} is not the tarball manifest pack-npm writes: ${problem}`);
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw refused(error instanceof Error ? error.message : String(error));
  }

  if (!Array.isArray(parsed) || parsed.length === 0) throw refused("not a non-empty array");

  return parsed.map((entry: unknown, index) => {
    const fields = isJsonRecord(entry) ? entry : {};
    const { file, name, version, sha256 } = fields;

    if (
      typeof file !== "string" ||
      typeof name !== "string" ||
      typeof version !== "string" ||
      typeof sha256 !== "string"
    )
      throw refused(`entry ${index} has no string file, name, version and sha256`);

    return { file, name, version, sha256 };
  });
}

/**
 * The tarballs the manifest lists, once the directory holds exactly them with their hashes, each tarball's own
 * manifest names the listed package and version, and the list is exactly the expected release. Throws a
 * `ReleaseError` naming every problem; nothing is returned on any.
 */
export function manifestTarballs(
  directory: string,
  manifest: readonly TarballManifestEntry[],
  expected: ExpectedRelease,
): Tarball[] {
  const problems = [
    ...releaseProblems(manifest, expected),
    ...directoryProblems(directory, manifest),
  ];

  if (problems.length > 0)
    throw new ReleaseError(
      `the tarballs are not the ones pack-npm checked, so nothing was published:\n  ${problems.join("\n  ")}`,
    );

  return manifest.map((entry) => {
    const file = join(directory, entry.file);
    const integrity = `sha512-${createHash("sha512").update(readFileSync(file)).digest("base64")}`;

    return { file, name: entry.name, version: entry.version, integrity };
  });
}

function releaseProblems(
  manifest: readonly TarballManifestEntry[],
  expected: ExpectedRelease,
): string[] {
  const listed = manifest.map((entry) => entry.name);
  const problems = manifest
    .filter((entry) => entry.version !== expected.version)
    .map((entry) => `${entry.file} is ${entry.name}@${entry.version}, not at ${expected.version}`);

  for (const name of expected.names)
    if (!listed.includes(name)) problems.push(`no tarball of ${name}, which the release publishes`);

  for (const name of listed)
    if (!expected.names.includes(name))
      problems.push(`${name} is not a package the release publishes`);

  for (const name of new Set(listed))
    if (listed.filter((other) => other === name).length > 1)
      problems.push(`${name} is listed more than once`);

  return problems;
}

function directoryProblems(directory: string, manifest: readonly TarballManifestEntry[]): string[] {
  const present = readdirSync(directory);
  const problems = present
    .filter((file) => !manifest.some((entry) => entry.file === file))
    .map((file) => `${file} is in the artefact, but not in the manifest`);

  for (const entry of manifest) {
    if (!present.includes(entry.file)) {
      problems.push(`${entry.file} is in the manifest, but not in the artefact`);
      continue;
    }

    const bytes = readFileSync(join(directory, entry.file));
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    if (sha256 !== entry.sha256) {
      problems.push(`${entry.file} hashes ${sha256}, not the ${entry.sha256} pack-npm wrote`);
      continue;
    }

    const packed = packedIdentity(join(directory, entry.file));

    if (packed.name !== entry.name || packed.version !== entry.version)
      problems.push(
        `${entry.file} packs ${packed.name}@${packed.version}, not ${entry.name}@${entry.version}`,
      );
  }

  return problems;
}

/** The name and version of a tarball's own package.json; a tarball without them is refused by file. */
export function packedIdentity(tarball: string): { name: string; version: string } {
  const manifest: unknown = JSON.parse(
    execFileSync("tar", ["-xzOf", tarball, TARBALL_MANIFEST_FILE], { encoding: "utf8" }),
  );
  const name = isJsonRecord(manifest) ? manifest.name : undefined;
  const version = isJsonRecord(manifest) ? manifest.version : undefined;

  if (typeof name !== "string" || typeof version !== "string")
    throw new ReleaseError(
      `${tarball}: its ${TARBALL_MANIFEST_FILE} has no string name and version`,
    );

  return { name, version };
}
