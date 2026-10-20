import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  BUNDLE_MANIFEST_FILE,
  type BundleManifest,
  compareBundlePaths,
} from "@seampact/spec/bundle";
import { bundleManifestBytes } from "./contents.js";
import { bundleIntegrity, bundleSha256Hex } from "./integrity.js";

// A tamper that a careless attacker would not make: the bundle's files changed, then the manifest's list, sizes,
// hashes and integrity recomputed to match, so the check fails at a later step than step 1.

/** Rewrites the manifest of `directory` over its files, after `edit`; returns the new integrity. */
export function resealBundle(
  directory: string,
  edit: (manifest: BundleManifest) => BundleManifest = (same) => same,
): string {
  const manifest = edit(JSON.parse(readFileSync(join(directory, BUNDLE_MANIFEST_FILE), "utf8")));
  const files = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => path !== BUNDLE_MANIFEST_FILE)
    .sort(compareBundlePaths)
    .map((path) => {
      const bytes = readFileSync(join(directory, path));

      return { path, size: bytes.length, sha256: bundleSha256Hex(bytes) };
    });
  const integrity = bundleIntegrity(files);

  writeFileSync(
    join(directory, BUNDLE_MANIFEST_FILE),
    bundleManifestBytes({ ...manifest, files, integrity }),
  );

  return integrity;
}
