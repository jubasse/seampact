// Contract bundles in the compiler (ADR 0011): the workspace bundled and written as a directory or a reproducible tarball, the tarball reader, the pinned-bundle check, the three channels that fetch a bundle with its cache, workspace imports and the local-source refusal.

export { type BundleBuildOptions, type BundleBuildResult, buildBundle } from "./build.js";
export {
  bundleCacheDirectory,
  CACHE_DIRECTORY_VARIABLE,
} from "./cache.js";
export {
  type BundleContents,
  type BundleEntry,
  bundleEntries,
  bundleManifestBytes,
} from "./contents.js";
export { type BundleFetchOptions, type BundleFetchResult, fetchBundle } from "./fetch.js";
export {
  BUNDLE_FETCH_FAILURE_CODES,
  type BundleFetchFailureCode,
  type BundleSourceFailure,
  bundleSourceText,
} from "./fetch-failure.js";
export {
  compileWorkspaceWithImports,
  type WorkspaceImportFailure,
  type WorkspaceImportsOptions,
  type WorkspaceImportsResult,
} from "./imports.js";
export { bundleIntegrity, bundleSha256Hex } from "./integrity.js";
export { findLocalPackageSources, type LocalPackageSource } from "./local-packages.js";
export {
  ALLOW_LOCAL_VARIABLE,
  type LocalSourcePolicy,
  localSourcePolicy,
  localSourceRefusalReason,
} from "./local-sources.js";
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
