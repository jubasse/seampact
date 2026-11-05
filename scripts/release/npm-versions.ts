// The npm side of the stamp: every workspace `package.json` at the release version, and the published packages
// without `private`. The published packages are the ones the consumers install from tarballs; the others are named
// here, so a new package is either published or kept private on purpose.
import { PACKED_PACKAGES, PACKED_PACKS } from "../consumers/packed-packages.ts";
import { packageDirectories } from "../workspace/index.ts";
import { ReleaseError } from "./release-version.ts";
import { readRepositoryFile, type VersionEdit } from "./version-edit.ts";

export const PUBLISHED_PACKAGES: readonly string[] = [...PACKED_PACKAGES, ...PACKED_PACKS];

// The binary is a release asset (ADR 0009), and the docs site is deployed, not installed.
export const UNPUBLISHED_PACKAGES: readonly string[] = [
  "packages/tools/binary",
  "packages/tools/docs-site",
];

const MANIFEST = "package.json";

export function npmVersionEdits(root: string, version: string): VersionEdit[] {
  const directories = packageDirectories(root);

  checkEveryPackageIsClassified(directories);

  return directories.map((directory) => manifestEdit(root, directory, version));
}

function checkEveryPackageIsClassified(directories: readonly string[]): void {
  const workspace = new Set(directories);
  const missing = [...PUBLISHED_PACKAGES, ...UNPUBLISHED_PACKAGES].filter(
    (directory) => !workspace.has(directory),
  );

  if (missing.length > 0)
    throw new ReleaseError(
      `${missing.join(", ")}: listed as a package, but the workspace has no such package directory; remove it from ` +
        "scripts/consumers/packed-packages.ts or UNPUBLISHED_PACKAGES of scripts/release/npm-versions.ts",
    );

  for (const directory of directories) {
    if (PUBLISHED_PACKAGES.includes(directory) || UNPUBLISHED_PACKAGES.includes(directory))
      continue;

    throw new ReleaseError(
      `${directory} is neither published nor unpublished: add it to PACKED_PACKAGES of ` +
        "scripts/consumers/packed-packages.ts, or to UNPUBLISHED_PACKAGES of scripts/release/npm-versions.ts",
    );
  }
}

function manifestEdit(root: string, directory: string, version: string): VersionEdit {
  const file = `${directory}/${MANIFEST}`;
  const before = readRepositoryFile(root, file);
  const manifest: unknown = JSON.parse(before);

  if (!isRecord(manifest)) throw new ReleaseError(`${file} is not a JSON object: fix the manifest`);

  const changes: string[] = [];

  if (manifest.version !== version) {
    changes.push(`version is ${JSON.stringify(manifest.version)}, not "${version}"`);
    manifest.version = version;
  }

  if (PUBLISHED_PACKAGES.includes(directory) && "private" in manifest) {
    changes.push("a published package is still `private`");
    delete manifest.private;
  }

  return { file, before, after: `${JSON.stringify(manifest, null, 2)}\n`, changes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
