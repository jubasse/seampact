import type { BundleFile } from "./manifest.js";

// The text the bundle integrity hashes (ADR 0011): one line per file, `<sha256 lowercase hex>  <path>\n`, the
// last line included, sorted by path in UTF-16 code-unit order (byte order too, as paths are ASCII), the
// manifest itself excluded. Encoded as UTF-8; the integrity is `sha256-` and the padded standard base64 of its
// SHA-256, the SRI form npm uses. `sha256sum -c` reads the same text.

export const BUNDLE_INTEGRITY_PREFIX = "sha256-";

/** The canonical file list of `files`, in any order. */
export function canonicalBundleFileList(
  files: readonly Pick<BundleFile, "path" | "sha256">[],
): string {
  const sorted = [...files].sort((left, right) => compareBundlePaths(left.path, right.path));

  return sorted.map((file) => `${file.sha256}  ${file.path}\n`).join("");
}

/** Code-unit order, never locale order. */
export function compareBundlePaths(left: string, right: string): number {
  if (left === right) return 0;

  return left < right ? -1 : 1;
}
