import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { errorCode } from "../error-code.js";
import { isSymbolicLink } from "../symbolic-link.js";

const GIT_IGNORE_FILE = ".gitignore";
const LINE_END = /\r?\n/;

/** How `.gitignore` changes: created, given the missing entries at its end, or already holding them all. */
export type GitIgnoreChange =
  | {
      readonly file: string;
      readonly change: "created" | "appended" | "unchanged";
      readonly text: string;
    }
  /** `.gitignore` is a symbolic link: writing it would change its target, maybe outside the project. */
  | { readonly file: string; readonly change: "link" };

// The `.gitignore` of `directory` holding each entry (such as `.seampact/`) once. A line counts when it is the
// entry with or without its trailing slash; a leading slash anchors a pattern to the root, so `/.seampact/` does
// not count for `.seampact/`. Lines added end as the file's first line does.
export async function gitIgnoreWithEntries(
  directory: string,
  entries: readonly string[],
): Promise<GitIgnoreChange> {
  const file = join(directory, GIT_IGNORE_FILE);

  if (await isSymbolicLink(file)) return { file, change: "link" };

  const existing = await readFile(file, "utf8").catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return undefined;

    throw error;
  });
  const present = new Set(
    (existing ?? "").split(LINE_END).map((line) => withoutTrailingSlash(line.trim())),
  );
  const missing = [...new Set(entries)].filter(
    (entry) => !present.has(withoutTrailingSlash(entry)),
  );
  const lineEnd = LINE_END.exec(existing ?? "")?.[0] ?? "\n";
  const added = missing.map((entry) => `${entry}${lineEnd}`).join("");

  if (existing === undefined) return { file, change: "created", text: added };

  if (missing.length === 0) return { file, change: "unchanged", text: existing };

  const separator = existing === "" || existing.endsWith("\n") ? "" : lineEnd;

  return { file, change: "appended", text: `${existing}${separator}${added}` };
}

function withoutTrailingSlash(pattern: string): string {
  return pattern.replace(/\/+$/, "");
}
