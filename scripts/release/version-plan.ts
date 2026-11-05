// Every version edit of a release, across npm, changesets, the JVM and Python. Composer needs none: sibling constraints are
// `self.version`, and the mirror tag gives the version. The stamp writes these edits; the version check fails on any.
import { changesetAccessEdit } from "./changeset-access.ts";
import { jvmVersionEdits } from "./jvm-versions.ts";
import { npmVersionEdits } from "./npm-versions.ts";
import { pythonVersionEdits } from "./python-versions.ts";
import type { VersionEdit } from "./version-edit.ts";

export function releaseVersionEdits(root: string, version: string): VersionEdit[] {
  return [
    ...npmVersionEdits(root, version),
    changesetAccessEdit(root),
    ...jvmVersionEdits(root, version),
    ...pythonVersionEdits(root, version),
  ];
}

/** One line per change, `<file>: <change>`, for the files not at the version yet. */
export function pendingVersionChanges(edits: readonly VersionEdit[]): string[] {
  return edits.flatMap((edit) => edit.changes.map((change) => `${edit.file}: ${change}`));
}
