// The one version a release gives every package of every ecosystem, and the error the release scripts fail with.

// `MAJOR.MINOR.PATCH` only: npm, PyPI and Maven spell a pre-release differently, so one string cannot serve all three.
const RELEASE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/** The version every package carries between releases. */
export const DEVELOPMENT_VERSION = "0.0.0";

export function isReleaseVersion(candidate: string): boolean {
  return RELEASE_VERSION_PATTERN.test(candidate) && candidate !== DEVELOPMENT_VERSION;
}

/** A release input or checkout the release cannot go on with; the message names the file and the fix. */
export class ReleaseError extends Error {}

/** The version, or a `ReleaseError` naming the accepted form. */
export function releaseVersion(candidate: string | undefined): string {
  if (candidate === undefined || candidate === "")
    throw new ReleaseError(
      "no release version given: pass it as `MAJOR.MINOR.PATCH`, for example 1.0.0",
    );

  if (!RELEASE_VERSION_PATTERN.test(candidate))
    throw new ReleaseError(
      `"${candidate}" is not a release version: write MAJOR.MINOR.PATCH without leading zeros; a pre-release is ` +
        "out of scope, since npm, PyPI and Maven spell it differently",
    );

  return candidate;
}
