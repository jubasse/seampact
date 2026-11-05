// The changesets side of the stamp: `access` turns "public" in `.changeset/config.json`, the form the package rules
// expect of a stamped release, since the published packages are public on npm. The value is replaced in the text,
// so the file keeps the layout the formatter gives it.
import { isJsonRecord } from "./json-record.ts";
import { ReleaseError } from "./release-version.ts";
import { readRepositoryFile, type VersionEdit } from "./version-edit.ts";

export const CHANGESET_CONFIG = ".changeset/config.json";
export const RELEASE_CHANGESET_ACCESS = "public";

const ACCESS_MEMBER = /("access"\s*:\s*)("[^"]*")/;

export function changesetAccessEdit(root: string): VersionEdit {
  const before = readRepositoryFile(root, CHANGESET_CONFIG);
  const config: unknown = JSON.parse(before);

  if (!isJsonRecord(config))
    throw new ReleaseError(`${CHANGESET_CONFIG} is not a JSON object: fix the changesets config`);

  if (config.access === RELEASE_CHANGESET_ACCESS)
    return { file: CHANGESET_CONFIG, before, after: before, changes: [] };

  if (!ACCESS_MEMBER.test(before))
    throw new ReleaseError(
      `${CHANGESET_CONFIG} has no string \`access\` member: add "access": "restricted", which the stamp turns public`,
    );

  return {
    file: CHANGESET_CONFIG,
    before,
    after: before.replace(ACCESS_MEMBER, `$1"${RELEASE_CHANGESET_ACCESS}"`),
    changes: [`access is ${JSON.stringify(config.access)}, not "${RELEASE_CHANGESET_ACCESS}"`],
  };
}
