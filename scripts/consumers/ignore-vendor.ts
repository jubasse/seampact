import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const GITIGNORE_FILE = ".gitignore";
const VENDOR_IGNORE_LINES = ["vendor/", "vendor", "/vendor/", "/vendor"];

// The packed tarballs are build output of this checkout: the app never commits them. Adds `vendor/` to the app's
// .gitignore unless a line already ignores it.
export function ignoreVendorDirectory(directory: string): void {
  const ignoreFile = join(directory, GITIGNORE_FILE);
  const lines = existsSync(ignoreFile) ? readFileSync(ignoreFile, "utf8").split(/\r?\n/) : [];

  if (lines.some((line) => VENDOR_IGNORE_LINES.includes(line.trim()))) return;

  const needsNewline = lines.length > 0 && lines.at(-1) !== "";

  appendFileSync(ignoreFile, `${needsNewline ? "\n" : ""}vendor/\n`);
}
