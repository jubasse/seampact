import type { BundleFailure, BundleFailureCode } from "@seampact/spec/bundle";
import type { BundleSource } from "@seampact/spec/config";

// The failures of fetching a bundle source before the pinned-bundle check reads it: the Node runner's channels,
// its cache and the workspace imports. A native runner fetches its own way, so these codes are not in the vectors.

export const BUNDLE_FETCH_FAILURE_CODES = [
  "bundle.package-missing",
  "bundle.package-version",
  "bundle.release-url",
  "bundle.release-failed",
  "bundle.git-url",
  "bundle.git-tag",
  "bundle.git-directory",
  "bundle.git-failed",
  "bundle.source-local",
  "bundle.cache-invalid",
  "bundle.import-api-missing",
] as const;

export type BundleFetchFailureCode = (typeof BUNDLE_FETCH_FAILURE_CODES)[number];

/** A failure of the fetch, of the archive reader or of the pinned-bundle check. */
export interface BundleSourceFailure extends Omit<BundleFailure, "code"> {
  readonly code: BundleFailureCode | BundleFetchFailureCode;
}

/** The source as the config writes it, for messages. */
export function bundleSourceText(source: BundleSource): string {
  if ("package" in source) return `package '${source.package}' version ${source.version}`;

  if ("release" in source) return `release '${source.release.url}'`;

  const directory =
    source.git.directory === undefined ? "" : `, directory '${source.git.directory}'`;

  return `git '${source.git.url}' tag '${source.git.tag}'${directory}`;
}
