// Workspace layout helpers shared by the repository scripts: where the npm packages live.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const PACKAGES_DIR = "packages";

/**
 * Repository-relative package directories, in code-unit order: `packages/<name>`, or
 * `packages/<group>/<name>` under a group directory that holds no `package.json` itself.
 */
export function packageDirectories(root: string): string[] {
  const found: string[] = [];
  for (const name of sortedSubdirectories(join(root, PACKAGES_DIR))) {
    const directory = `${PACKAGES_DIR}/${name}`;
    if (existsSync(join(root, directory, "package.json"))) {
      found.push(directory);
      continue;
    }

    for (const member of sortedSubdirectories(join(root, directory))) {
      const memberDirectory = `${directory}/${member}`;
      if (existsSync(join(root, memberDirectory, "package.json"))) found.push(memberDirectory);
    }
  }
  return found;
}

function sortedSubdirectories(directory: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith("."),
    )
    .map((entry) => entry.name)
    .sort();
}
