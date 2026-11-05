// The edit the stamp makes to one version file: its text before and after, and each change in words, which the
// version check reports when the checkout is not at the release version.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ReleaseError } from "./release-version.ts";

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

/**
 * The edit of the one version a file spells in a known line: `line` captures the text before the version, the
 * version and the text after it. A missing file or line throws, naming what the stamp looks for.
 */
export function lineVersionEdit(
  root: string,
  file: string,
  line: RegExp,
  version: string,
  field: string,
): VersionEdit {
  if (!existsSync(join(root, file)))
    throw new ReleaseError(`${file} does not exist: the stamp writes ${field} there`);

  const before = readRepositoryFile(root, file);
  const current = line.exec(before);

  if (current === null)
    throw new ReleaseError(
      `${file} has no line the stamp can read ${field} from (${line.source}): restore its form`,
    );

  const [, prefix, written, suffix] = current;

  if (written === version) return { file, before, after: before, changes: [] };

  return {
    file,
    before,
    after: before.replace(line, `${prefix}${version}${suffix}`),
    changes: [`${field} is "${written}", not "${version}"`],
  };
}
