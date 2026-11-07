import { createHash } from "node:crypto";
import {
  BUNDLE_INTEGRITY_PREFIX,
  type BundleFile,
  canonicalBundleFileList,
} from "@seampact/spec/bundle";

/** The lowercase hexadecimal SHA-256 of a file's bytes. */
export function bundleSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `sha256-` and the padded standard base64 of the SHA-256 of the canonical file list, as UTF-8. */
export function bundleIntegrity(files: readonly Pick<BundleFile, "path" | "sha256">[]): string {
  const digest = createHash("sha256")
    .update(canonicalBundleFileList(files), "utf8")
    .digest("base64");

  return `${BUNDLE_INTEGRITY_PREFIX}${digest}`;
}
