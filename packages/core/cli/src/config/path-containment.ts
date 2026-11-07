import { isAbsolute, relative, sep } from "node:path";

// Whether one absolute path lies under another, by their text: the config's paths are resolved, not real paths.

export function isStrictlyInside(parent: string, child: string): boolean {
  return child !== parent && isInsideOrEqual(parent, child);
}

export function isInsideOrEqual(parent: string, child: string): boolean {
  const path = relative(parent, child);

  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}
