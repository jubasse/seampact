// Contract bundles (`@seampact/spec/bundle`, ADR 0011): the manifest types and JSON Schema, the portable-path rule, the canonical file list the integrity hashes, the manifest rules beyond the schema and the failure codes.
//
// The vectors every verifier proves itself on are `@seampact/spec/bundle/vectors/*.json`.

export {
  BUNDLE_ARCHIVE_FAILURE_CODES,
  BUNDLE_VERIFY_FAILURE_CODES,
  BUNDLE_WRITE_FAILURE_CODES,
  type BundleArchiveFailureCode,
  type BundleFailure,
  type BundleFailureCode,
  type BundleVerifyFailureCode,
  type BundleWriteFailureCode,
} from "./failure.js";
export {
  BUNDLE_INTEGRITY_PREFIX,
  canonicalBundleFileList,
  compareBundlePaths,
} from "./file-list.js";
export { bundleLabelProblem } from "./label.js";
export {
  BUNDLE_ARCHIVE_BYTES_MAX,
  BUNDLE_ENTRIES_MAX,
  BUNDLE_EXTRACTED_BYTES_MAX,
  BUNDLE_MANIFEST_BYTES_MAX,
} from "./limits.js";
export {
  BUNDLE_FORMAT_VERSION,
  BUNDLE_IR_DIRECTORY,
  BUNDLE_MANIFEST_FILE,
  BUNDLE_MANIFEST_SCHEMA,
  BUNDLE_MANIFEST_SCHEMA_ID,
  BUNDLE_PACKS_DIRECTORY,
  BUNDLE_SOURCES_DIRECTORY,
  type BundleApi,
  type BundleFile,
  type BundleManifest,
  type BundleNamedVersion,
} from "./manifest.js";
export { type BundleManifestProblem, bundleManifestRuleProblems } from "./manifest-rules.js";
export {
  BUNDLE_PATH_DEVICE_PATTERN,
  BUNDLE_PATH_MAX_LENGTH,
  BUNDLE_PATH_PATTERN,
  bundlePathFold,
  bundlePathProblem,
} from "./path.js";
