// The manifest of a JVM staging bundle: the path and SHA-256 of every file of a Maven repository directory, written
// by build-jvm once the bundle is checked and passed to the publish jobs as a job output, outside the artefact. A job
// that publishes takes exactly the files it lists, each checked against its hash, and refuses any other file, so
// bytes replaced in the artefact after build-jvm never reach a registry.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isJsonRecord } from "../json-record.ts";
import { ReleaseError } from "../release-version.ts";

export interface BundleManifestEntry {
  /** The path in the repository directory, with `/` separators. */
  readonly path: string;
  readonly sha256: string;
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Every file under the directory, as `/`-separated paths relative to it, sorted. */
export function repositoryFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

export function bundleManifest(directory: string): BundleManifestEntry[] {
  return repositoryFiles(directory).map((path) => ({
    path,
    sha256: sha256Of(readFileSync(join(directory, path))),
  }));
}

export function parsedBundleManifest(text: string, source: string): BundleManifestEntry[] {
  const refused = (problem: string) =>
    new ReleaseError(`${source} is not the bundle manifest build-jvm writes: ${problem}`);
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw refused(error instanceof Error ? error.message : String(error));
  }

  if (!Array.isArray(parsed) || parsed.length === 0) throw refused("not a non-empty array");

  return parsed.map((entry: unknown, index) => {
    const fields = isJsonRecord(entry) ? entry : {};
    const { path, sha256 } = fields;

    if (typeof path !== "string" || typeof sha256 !== "string")
      throw refused(`entry ${index} has no string path and sha256`);

    return { path, sha256 };
  });
}

/**
 * Checks that the directory holds exactly the files of the manifest, each with its hash; throws a `ReleaseError`
 * naming every problem.
 */
export function checkBundleAgainstManifest(
  directory: string,
  manifest: readonly BundleManifestEntry[],
): void {
  const present = repositoryFiles(directory);
  const listed = new Map(manifest.map((entry) => [entry.path, entry.sha256]));
  const problems = present
    .filter((path) => !listed.has(path))
    .map((path) => `${path} is in the artefact, but not in the manifest`);

  for (const [path, expected] of listed) {
    if (!present.includes(path)) {
      problems.push(`${path} is in the manifest, but not in the artefact`);
      continue;
    }

    const actual = sha256Of(readFileSync(join(directory, path)));

    if (actual !== expected)
      problems.push(`${path} hashes ${actual}, not the ${expected} build-jvm wrote`);
  }

  if (problems.length > 0)
    throw new ReleaseError(
      `the bundle is not the one build-jvm checked, so nothing was published:\n  ${problems.join("\n  ")}`,
    );
}
