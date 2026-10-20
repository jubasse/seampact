// Contract bundles in the compiler (ADR 0011): the workspace bundled and written as a directory or a reproducible tarball, the tarball reader, and the pinned-bundle check.

export { type BundleBuildOptions, type BundleBuildResult, buildBundle } from "./build.js";
export {
  type BundleContents,
  type BundleEntry,
  bundleEntries,
  bundleManifestBytes,
} from "./contents.js";
export { bundleIntegrity, bundleSha256Hex } from "./integrity.js";
export {
  type BundleArchiveExtraction,
  type BundleArchiveRead,
  extractBundleTarball,
  readBundleTarball,
} from "./tarball-read.js";
export { bundleTarball } from "./tarball-write.js";
export {
  type BundleChannel,
  type BundleVerifyOptions,
  type BundleVerifyResult,
  verifyBundle,
} from "./verify.js";
export {
  type BundleOutput,
  type BundleWriteOptions,
  type BundleWriteResult,
  writeBundle,
} from "./write.js";
