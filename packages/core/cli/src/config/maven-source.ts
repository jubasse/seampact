import type { AppSource } from "@seampact/spec/config";
import type { CliProblem } from "../cli-problem.js";
import { type ParsedConfig, whereOf } from "./config-file.js";

// A `maven` source pins one release (ADR 0010): a dynamic version (`+`, `1.+`, `latest.release`, a range) or a
// `-SNAPSHOT` would resolve whatever the repository holds today, and the integrity pin would then fail without
// naming why, so each is refused by name. The JVM reader refuses the same versions with the same code.

const SNAPSHOT_SUFFIX = "-snapshot";
const LATEST_PREFIX = "latest.";
const RANGE_CHARACTERS = /[[\](),]/u;

export function unpinnedMavenProblems(
  parsed: ParsedConfig,
  sources: Readonly<Record<string, AppSource>> | undefined,
): CliProblem[] {
  return Object.entries(sources ?? {}).flatMap(([name, source]) => {
    if (!("maven" in source)) return [];

    const version = source.maven.split(":")[2] ?? "";

    if (!isUnpinnedVersion(version)) return [];

    return [
      {
        code: "config.source.maven-unpinned",
        message: `The source '${name}' names the Maven version '${version}', a dynamic or snapshot version; the integrity pin needs one release.`,
        fix: "Name a release version, such as 1.4.0, and pin its integrity.",
        where: whereOf(parsed, ["sources", name, "maven"]),
      },
    ];
  });
}

function isUnpinnedVersion(version: string): boolean {
  const lower = version.toLowerCase();

  return (
    lower.endsWith("+") ||
    lower.startsWith(LATEST_PREFIX) ||
    lower.endsWith(SNAPSHOT_SUFFIX) ||
    RANGE_CHARACTERS.test(version)
  );
}
