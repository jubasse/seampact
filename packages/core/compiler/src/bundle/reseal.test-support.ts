import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  BUNDLE_MANIFEST_FILE,
  type BundleManifest,
  compareBundlePaths,
} from "@seampact/spec/bundle";
import { bundleManifestBytes } from "./contents.js";
import { bundleIntegrity, bundleSha256Hex } from "./integrity.js";

// A tamper a careless attacker would not make: the bundle's files changed, then the manifest's list, sizes, hashes
// and integrity recomputed to match, so the check fails at a later step than step 1.

export type ManifestEdit = (manifest: BundleManifest) => BundleManifest;

const unchanged: ManifestEdit = (manifest) => manifest;

/** Rewrites the manifest among `files` (bundle path to bytes) over the other files, after `edit`; returns the integrity. */
export function resealFiles(
  files: Map<string, Uint8Array>,
  edit: ManifestEdit = unchanged,
): string {
  const manifestBytes = files.get(BUNDLE_MANIFEST_FILE);

  if (manifestBytes === undefined) throw new Error("reseal: the bundle has no manifest");

  const manifest = edit(JSON.parse(new TextDecoder().decode(manifestBytes)));
  const listed = [...files]
    .filter(([path]) => path !== BUNDLE_MANIFEST_FILE)
    .sort(([left], [right]) => compareBundlePaths(left, right))
    .map(([path, bytes]) => ({ path, size: bytes.length, sha256: bundleSha256Hex(bytes) }));
  const integrity = bundleIntegrity(listed);

  files.set(BUNDLE_MANIFEST_FILE, bundleManifestBytes({ ...manifest, files: listed, integrity }));

  return integrity;
}

/** `resealFiles` on a bundle directory. */
export function resealBundle(directory: string, edit: ManifestEdit = unchanged): string {
  const files = new Map(
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"))
      .map((path) => [path, new Uint8Array(readFileSync(join(directory, path)))]),
  );
  const integrity = resealFiles(files, edit);
  const manifestBytes = files.get(BUNDLE_MANIFEST_FILE);

  if (manifestBytes !== undefined)
    writeFileSync(join(directory, BUNDLE_MANIFEST_FILE), manifestBytes);

  return integrity;
}
