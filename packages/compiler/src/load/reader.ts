import * as fs from "node:fs";
import * as path from "node:path";

// ADR 0010, the standalone binary: the loader reads files only through this interface, so a
// runtime without Node's `fs` (the Bun fallback) swaps one implementation, nothing else.
// Every path is root-relative with forward slashes; `..` segments appear only when a pack is
// resolved from a package above the workspace root.
export interface LoadReader {
  /** The file's text, or undefined when it does not exist or is not a file. */
  readText(file: string): string | undefined;
  /** The names in a directory, or undefined when it does not exist. */
  listDir(dir: string): string[] | undefined;
  /** The root-relative path after following symlinks, or undefined when it does not exist. */
  realPath(file: string): string | undefined;
  /** How many `..` steps above the root the reader can address (bounds the node_modules walk). */
  readonly ascent: number;
}

function toPosix(p: string): string {
  return path.sep === "/" ? p : p.split(path.sep).join("/");
}

export function loadFsReader(root: string): LoadReader {
  const absRoot = path.resolve(root);
  const realRoot = fs.realpathSync(absRoot);
  const abs = (file: string) => path.resolve(absRoot, file);
  return {
    ascent: absRoot.split(path.sep).filter(Boolean).length,
    readText(file) {
      try {
        const target = abs(file);
        if (!fs.statSync(target).isFile()) return undefined;
        return fs.readFileSync(target, "utf8");
      } catch {
        return undefined;
      }
    },
    listDir(dir) {
      try {
        return fs.readdirSync(abs(dir));
      } catch {
        return undefined;
      }
    },
    realPath(file) {
      try {
        const real = fs.realpathSync(abs(file));
        return toPosix(path.relative(realRoot, real)) || ".";
      } catch {
        return undefined;
      }
    },
  };
}

export interface LoadMemoryOptions {
  /** Symlinks: link path to target path, both root-relative. */
  links?: Record<string, string>;
  ascent?: number;
}

function normalizeKey(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** A reader over an in-memory map of root-relative path to text, for tests. */
export function loadMemoryReader(
  files: Record<string, string>,
  options: LoadMemoryOptions = {},
): LoadReader {
  const links = Object.entries(options.links ?? {}).map(
    ([from, to]) => [normalizeKey(from), normalizeKey(to)] as const,
  );
  const table = new Map(Object.entries(files).map(([k, v]) => [normalizeKey(k), v]));
  const resolve = (file: string): string => {
    let current = normalizeKey(file);
    for (let hop = 0; hop < 16; hop++) {
      const link = links.find(([from]) => current === from || current.startsWith(`${from}/`));
      if (!link) return current;
      current = normalizeKey(`${link[1]}${current.slice(link[0].length)}`);
    }
    return current;
  };
  return {
    ascent: options.ascent ?? 3,
    readText: (file) => table.get(resolve(file)),
    listDir(dir) {
      const base = resolve(dir);
      const prefix = base === "" ? "" : `${base}/`;
      const names = new Set<string>();
      for (const key of table.keys()) {
        if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0] as string);
      }
      for (const [from] of links) {
        if (from.startsWith(prefix) && from !== base) {
          names.add(from.slice(prefix.length).split("/")[0] as string);
        }
      }
      return names.size > 0 ? [...names] : undefined;
    },
    realPath(file) {
      const real = resolve(file);
      const exists = table.has(real) || [...table.keys()].some((k) => k.startsWith(`${real}/`));
      return exists ? real || "." : undefined;
    },
  };
}
