// The edit the stamp makes to one version file: its text before and after, and each change in words, which the
// version check reports when the checkout is not at the release version.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface VersionEdit {
  /** Repository-relative path. */
  readonly file: string;
  readonly before: string;
  readonly after: string;
  /** One line per field the stamp changes; empty when the file is already at the version. */
  readonly changes: readonly string[];
}

export function readRepositoryFile(root: string, file: string): string {
  return readFileSync(join(root, file), "utf8");
}
