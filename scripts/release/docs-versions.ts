// The docs side of the stamp: the release version the install snippets show, so a reader who copies them gets the
// release the docs describe. The skill reference is a generated copy of its docs page (`node scripts/skills/cli.ts`),
// stamped alike so the copy stays equal to what the generator writes.
import { fieldsVersionEdit, type VersionEdit, type VersionField } from "./version-edit.ts";

const GRADLE_PLUGIN: VersionField = {
  line: /^( *id\("io\.github\.jubasse\.seampact"\) version ")([^"]*)(")$/m,
  field: "the Gradle plugin version",
};

const MAVEN_PLUGIN: VersionField = {
  line: /^( *<artifactId>seampact-maven-plugin<\/artifactId>\n *<version>)([^<$]*)(<\/version>)$/m,
  field: "the Maven plugin version",
};

const SEAMPACT_VERSION_PROPERTY: VersionField = {
  line: /(`<seampact\.version>)([^<]*)(<\/seampact\.version>`)/,
  field: "the seampact.version property",
};

export const DOCS_VERSION_FILES: Readonly<Record<string, readonly VersionField[]>> = {
  "packages/tools/docs-site/home/index.mdx": [GRADLE_PLUGIN, MAVEN_PLUGIN],
  "docs/getting-started/install-other-ecosystems.md": [GRADLE_PLUGIN, MAVEN_PLUGIN],
  "docs/backend/spring-boot.md": [SEAMPACT_VERSION_PROPERTY],
  "skills/seampact-setup/references/spring-boot.md": [SEAMPACT_VERSION_PROPERTY],
};

export function docsVersionEdits(root: string, version: string): VersionEdit[] {
  return Object.entries(DOCS_VERSION_FILES).map(([file, fields]) =>
    fieldsVersionEdit(root, file, fields, version),
  );
}
