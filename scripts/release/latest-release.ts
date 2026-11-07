// Whether a release is marked latest on GitHub: only when its version is above every published release, so a
// hotfix of an older line never takes the mark. Reads the published tags, one per line, on stdin; prints true or
// false.
//   gh release list --exclude-drafts --json tagName --jq '.[].tagName' | node scripts/release/latest-release.ts <version>
import { readFileSync } from "node:fs";
import { parsedArguments, runReleaseCommand } from "./release-cli.ts";
import { hasReleaseForm, releaseVersion } from "./release-version.ts";

const TAG_PREFIX = "v";
const STANDARD_INPUT = 0;

/** Tags outside the `v<MAJOR.MINOR.PATCH>` form this workflow writes are no release of it, and are not compared. */
export function isLatestRelease(version: string, publishedTags: readonly string[]): boolean {
  const released = publishedTags
    .filter((tag) => tag.startsWith(TAG_PREFIX) && hasReleaseForm(tag.slice(TAG_PREFIX.length)))
    .map((tag) => tag.slice(TAG_PREFIX.length));

  return released.every((other) => compareVersions(version, other) > 0);
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (const [index, part] of leftParts.entries()) {
    const difference = part - (rightParts[index] ?? 0);

    if (difference !== 0) return difference;
  }

  return 0;
}

if (import.meta.main)
  await runReleaseCommand("latest-release", () => {
    const { positionals } = parsedArguments({}, "node scripts/release/latest-release.ts <version>");
    const version = releaseVersion(positionals[0]);
    const tags = readFileSync(STANDARD_INPUT, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");

    console.log(String(isLatestRelease(version, tags)));
  });
