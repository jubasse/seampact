// The pack side of the stamp: the `pack.version` of each published pack's manifest, which the loader requires to
// equal the version of the pack's package.json (grammar section 02). A line edit of the `pack:` mapping, so the YAML
// keeps its comments and layout.
import { PACKED_PACKS } from "../consumers/packed-packages.ts";
import { isJsonRecord } from "./json-record.ts";
import { ReleaseError } from "./release-version.ts";
import { lineVersionEdit, readRepositoryFile, type VersionEdit } from "./version-edit.ts";

/** The `version` of the one-line `pack: { name: ..., version: ..., ... }` mapping. */
export const PACK_VERSION_LINE = /^(pack:\s*\{[^}\n]*\bversion:\s*)([^,}\s]+)([^\n]*)$/m;

export function packVersionEdits(root: string, version: string): VersionEdit[] {
  return PACKED_PACKS.map((directory) =>
    lineVersionEdit(
      root,
      packManifest(root, directory),
      PACK_VERSION_LINE,
      version,
      "pack.version",
    ),
  );
}

/** The repository-relative path of the pack manifest the package's `seampact.pack` names. */
export function packManifest(root: string, directory: string): string {
  const file = `${directory}/package.json`;
  const manifest: unknown = JSON.parse(readRepositoryFile(root, file));
  const seampact = isJsonRecord(manifest) ? manifest.seampact : undefined;
  const entry = isJsonRecord(seampact) ? seampact.pack : undefined;

  if (typeof entry !== "string")
    throw new ReleaseError(
      `${file} names no \`seampact.pack\`: a pack names its YAML manifest there`,
    );

  return `${directory}/${entry}`;
}
