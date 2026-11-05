// The changesets side of the stamp: `access` turns "public" in `.changeset/config.json`, the form the package rules
// expect of a stamped release, since the published packages are public on npm.
import { isJsonRecord } from "./json-record.ts";
import { ReleaseError } from "./release-version.ts";
import { readRepositoryFile, type VersionEdit } from "./version-edit.ts";

export const CHANGESET_CONFIG = ".changeset/config.json";
export const RELEASE_CHANGESET_ACCESS = "public";

export function changesetAccessEdit(root: string): VersionEdit {
  const before = readRepositoryFile(root, CHANGESET_CONFIG);
  const config: unknown = JSON.parse(before);

  if (!isJsonRecord(config))
    throw new ReleaseError(`${CHANGESET_CONFIG} is not a JSON object: fix the changesets config`);

  const changes: string[] = [];

  if (config.access !== RELEASE_CHANGESET_ACCESS) {
    changes.push(`access is ${JSON.stringify(config.access)}, not "${RELEASE_CHANGESET_ACCESS}"`);
    config.access = RELEASE_CHANGESET_ACCESS;
  }

  return { file: CHANGESET_CONFIG, before, after: `${JSON.stringify(config, null, 2)}\n`, changes };
}
