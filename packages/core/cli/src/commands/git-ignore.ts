import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { errorCode } from "../error-code.js";

const GIT_IGNORE_FILE = ".gitignore";

/** How `.gitignore` changes: created, given the missing entries at its end, or already holding them all. */
export interface GitIgnoreChange {
  readonly file: string;
  readonly change: "created" | "appended" | "unchanged";
  readonly text: string;
}

// The `.gitignore` of `directory` holding each entry (such as `.seampact/`) once: an equal line, with or without
// its leading or trailing slash, already counts.
export async function gitIgnoreWithEntries(
  directory: string,
  entries: readonly string[],
): Promise<GitIgnoreChange> {
  const file = join(directory, GIT_IGNORE_FILE);
  const existing = await readFile(file, "utf8").catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return undefined;

    throw error;
  });

  const present = new Set(
    (existing ?? "").split(/\r?\n/).map((line) => withoutSlashes(line.trim())),
  );
  const missing = [...new Set(entries)].filter((entry) => !present.has(withoutSlashes(entry)));
  const added = missing.map((entry) => `${entry}\n`).join("");

  if (existing === undefined) return { file, change: "created", text: added };

  if (missing.length === 0) return { file, change: "unchanged", text: existing };

  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";

  return { file, change: "appended", text: `${existing}${separator}${added}` };
}

function withoutSlashes(pattern: string): string {
  return pattern.replace(/^\/+/, "").replace(/\/+$/, "");
}
