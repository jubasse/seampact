// The edit the stamp makes to one version file: its text before and after, and each change in words, which the
// version check reports when the checkout is not at the release version.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

const CRLF = "\r\n";

/** The file's text with LF line endings, so the stamp's patterns read a Windows checkout as on Linux. */
export function readRepositoryFile(root: string, file: string): string {
  return readFileSync(join(root, file), "utf8").replaceAll(CRLF, "\n");
}

/** Writes the edit's text in the line endings the file has on disk. */
export function writeVersionEdit(root: string, edit: VersionEdit): void {
  const path = join(root, edit.file);
  const usesCrlf = readFileSync(path, "utf8").includes(CRLF);

  writeFileSync(path, usesCrlf ? edit.after.replaceAll("\n", CRLF) : edit.after);
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
  return fieldsVersionEdit(root, file, [{ line, field }], version);
}

/** One version a file spells, in the form `lineVersionEdit` reads it. */
export interface VersionField {
  readonly line: RegExp;
  readonly field: string;
}

/** The edit of several versions one file spells, each in its own known line. */
export function fieldsVersionEdit(
  root: string,
  file: string,
  fields: readonly VersionField[],
  version: string,
): VersionEdit {
  const fieldNames = fields.map((versionField) => versionField.field).join(", ");

  if (!existsSync(join(root, file)))
    throw new ReleaseError(`${file} does not exist: the stamp writes ${fieldNames} there`);

  const before = readRepositoryFile(root, file);
  let after = before;
  const changes: string[] = [];

  for (const { line, field } of fields) {
    const current = line.exec(after);

    if (current === null)
      throw new ReleaseError(
        `${file} has no line the stamp can read ${field} from (${line.source}): restore its form`,
      );

    const [, prefix, written, suffix] = current;

    if (written === version) continue;

    after = after.replace(line, `${prefix}${version}${suffix}`);
    changes.push(`${field} is "${written}", not "${version}"`);
  }

  return { file, before, after, changes };
}
