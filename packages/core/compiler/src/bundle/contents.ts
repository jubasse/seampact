import {
  BUNDLE_MANIFEST_FILE,
  type BundleManifest,
  compareBundlePaths,
} from "@seampact/spec/bundle";
import { finalizeSerializeJson } from "../finalize/serialize.js";

// A bundle in memory: its manifest and the bytes of every file the manifest lists. The directory writer and the
// tarball writer both write `bundleEntries`, so the two forms hold the same bytes.

export interface BundleContents {
  readonly manifest: BundleManifest;
  /** Every listed file's bytes by bundle path; the manifest is not one of them. */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export interface BundleEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** The manifest's bytes: byte-stable JSON (`docs/ir/10-byte-stable-serialisation.md`) as UTF-8. */
export function bundleManifestBytes(manifest: BundleManifest): Uint8Array {
  return new TextEncoder().encode(finalizeSerializeJson(manifest));
}

/** The manifest and every listed file, sorted by path in code-unit order. */
export function bundleEntries(contents: BundleContents): BundleEntry[] {
  const entries: BundleEntry[] = [
    { path: BUNDLE_MANIFEST_FILE, bytes: bundleManifestBytes(contents.manifest) },
    ...[...contents.files].map(([path, bytes]) => ({ path, bytes })),
  ];

  return entries.sort((left, right) => compareBundlePaths(left.path, right.path));
}
