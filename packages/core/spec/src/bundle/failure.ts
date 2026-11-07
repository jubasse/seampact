// The failure codes of the bundle writer, the archive reader and the pinned-bundle check. A native verifier
// reports the same code for the same bundle (the vectors in `vectors/bundle/` hold the expected codes).

export const BUNDLE_VERIFY_FAILURE_CODES = [
  "bundle.manifest-missing",
  "bundle.manifest-too-large",
  "bundle.manifest-invalid",
  "bundle.file-missing",
  "bundle.file-size",
  "bundle.file-hash",
  "bundle.file-unlisted",
  "bundle.file-type",
  "bundle.too-many-files",
  "bundle.too-large",
  "bundle.integrity-mismatch",
  "bundle.pin-missing",
  "bundle.pin-mismatch",
  "bundle.ir-unreadable",
  "bundle.ir-declaration",
  "bundle.ir-version",
  "bundle.ir-revision",
  "bundle.ir-invalid",
] as const;

export const BUNDLE_ARCHIVE_FAILURE_CODES = [
  "bundle.archive-too-large",
  "bundle.archive-invalid",
  "bundle.archive-entry-path",
  "bundle.archive-entry-type",
  "bundle.archive-entry-duplicate",
  "bundle.archive-too-many-entries",
  "bundle.archive-extracted-too-large",
] as const;

export const BUNDLE_WRITE_FAILURE_CODES = [
  "bundle.compile-failed",
  "bundle.contract-missing",
  "bundle.label-invalid",
  "bundle.file-outside-root",
  "bundle.path-unportable",
  "bundle.pack-unreadable",
  "bundle.imports-unsupported",
  "bundle.output-not-empty",
] as const;

export type BundleVerifyFailureCode = (typeof BUNDLE_VERIFY_FAILURE_CODES)[number];
export type BundleArchiveFailureCode = (typeof BUNDLE_ARCHIVE_FAILURE_CODES)[number];
export type BundleWriteFailureCode = (typeof BUNDLE_WRITE_FAILURE_CODES)[number];
export type BundleFailureCode =
  | BundleVerifyFailureCode
  | BundleArchiveFailureCode
  | BundleWriteFailureCode;

export interface BundleFailure {
  readonly code: BundleFailureCode;
  readonly message: string;
  readonly fix: string;
  /** The bundle path (or archive entry, or source file) the failure is about. */
  readonly file?: string;
  /** The two values that differ: what was expected (the manifest, the pin) and what was found. */
  readonly expected?: string;
  readonly actual?: string;
}
