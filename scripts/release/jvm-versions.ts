// The JVM side of the stamp: `version` in `jvm/gradle.properties`, which Gradle gives every project of the build,
// and the `seampact.version` the Spring Boot consumer's Maven build resolves the modules that build publishes at.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ReleaseError } from "./release-version.ts";
import { lineVersionEdit, readRepositoryFile, type VersionEdit } from "./version-edit.ts";

export const GRADLE_PROPERTIES = "jvm/gradle.properties";
const CONSUMER_MAVEN_BUILD = "scripts/consumers/targets/spring-boot/maven/pom.xml";

const VERSION_LINE = /^version=(.*)$/m;
const CONSUMER_SEAMPACT_VERSION = /^( *<seampact\.version>)([^<]*)(<\/seampact\.version>)$/m;

export function jvmVersionEdits(root: string, version: string): VersionEdit[] {
  return [
    ...gradlePropertiesEdits(root, version),
    lineVersionEdit(
      root,
      CONSUMER_MAVEN_BUILD,
      CONSUMER_SEAMPACT_VERSION,
      version,
      "seampact.version",
    ),
  ];
}

function gradlePropertiesEdits(root: string, version: string): VersionEdit[] {
  if (!existsSync(join(root, GRADLE_PROPERTIES)))
    throw new ReleaseError(
      `${GRADLE_PROPERTIES} does not exist: the JVM build reads its version there`,
    );

  const before = readRepositoryFile(root, GRADLE_PROPERTIES);
  const current = VERSION_LINE.exec(before);

  if (current === null) {
    const separator = before.endsWith("\n") ? "\n" : "\n\n";
    const after = `${before}${separator}# The release version of every module, written by scripts/release/stamp.ts.\nversion=${version}\n`;

    return [{ file: GRADLE_PROPERTIES, before, after, changes: ["has no `version` property"] }];
  }

  if (current[1] === version)
    return [{ file: GRADLE_PROPERTIES, before, after: before, changes: [] }];

  return [
    {
      file: GRADLE_PROPERTIES,
      before,
      after: before.replace(VERSION_LINE, `version=${version}`),
      changes: [`version is "${current[1]}", not "${version}"`],
    },
  ];
}
