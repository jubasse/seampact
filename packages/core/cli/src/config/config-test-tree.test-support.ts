import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Temporary directory trees of config files for the config readers' tests, removed by `removeConfigTrees`.

const temporaryDirectories: string[] = [];

// Writes each file of `files` (relative path to text) under a new temporary directory and returns that directory.
export function writeConfigTree(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), "seampact-cli-"));

  temporaryDirectories.push(directory);

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  }

  return directory;
}

export function removeConfigTrees(): void {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
}
