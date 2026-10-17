import * as fs from "node:fs";
import * as path from "node:path";

// ADR 0010, the standalone binary: the loader reads files only through this interface, so a
// runtime without Node's `fs` (the Bun fallback) swaps one implementation, nothing else.
// Every path is root-relative with forward slashes; `..` segments appear only when a pack is
// resolved from a package above the workspace root.
/** A file's text, or `tooLarge` when it holds more than the bytes asked for (it is not read). */
export type LoadText = { text: string } | { tooLarge: true };

export interface LoadReader {
  /** The file's text, or undefined when it does not exist or is not a file. */
  readText(file: string, maxBytes: number): LoadText | undefined;
  /** The names in a directory, or undefined when it does not exist. */
  listDir(dir: string): string[] | undefined;
  /**
   * The root-relative path after following symlinks, or undefined when it does not exist. A
   * target the root cannot reach by a relative path (another drive, a UNC share) is returned
   * absolute, and the loader treats an absolute path as outside every boundary.
   */
  realPath(file: string): string | undefined;
  /** How many `..` steps above the root the reader can address (bounds the node_modules walk). */
  readonly ascent: number;
}

type PathApi = Pick<typeof path, "sep" | "relative" | "isAbsolute" | "parse">;

function toPosix(p: string, api: PathApi): string {
  return api.sep === "/" ? p : p.split(api.sep).join("/");
}

/**
 * `real` relative to `realRoot`, with forward slashes. On Windows `path.relative` gives an
 * absolute result for another drive or a UNC share; it stays absolute (`D:/x`, `//host/share/x`)
 * so that `isInside` refuses it.
 */
export function loadRootRelative(realRoot: string, real: string, api: PathApi = path): string {
  const rel = api.relative(realRoot, real);
  if (api.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return toPosix(rel, api);
  return toPosix(rel, api) || ".";
}

/** How many directories sit between the file system root (`/`, `C:\`, a UNC share) and `absRoot`. */
export function loadAscentOf(absRoot: string, api: PathApi = path): number {
  const { root } = api.parse(absRoot);
  return absRoot.slice(root.length).split(api.sep).filter(Boolean).length;
}

/**
 * Paths resolve against the root's real path, as Node's own module resolution does, so a
 * lexical path, a checked real path and a `node_modules` walk above the root agree.
 */
export function loadFsReader(root: string): LoadReader {
  const realRoot = fs.realpathSync(path.resolve(root));
  const abs = (file: string) => path.resolve(realRoot, file);
  return {
    ascent: loadAscentOf(realRoot),
    readText(file, maxBytes) {
      const target = abs(file);
      let fd: number | undefined;
      try {
        // stat first: opening a FIFO would block.
        if (!fs.statSync(target).isFile()) return undefined;
        fd = fs.openSync(target, "r");
        const stat = fs.fstatSync(fd);
        if (!stat.isFile()) return undefined;
        if (stat.size > maxBytes) return { tooLarge: true };
        // Read to the end, never more than the cap: the file may have grown since fstat.
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const chunk = new Uint8Array(Math.min(65536, maxBytes + 1 - total));
          const n = fs.readSync(fd, chunk, 0, chunk.length, null);
          if (n === 0) break;
          chunks.push(chunk.subarray(0, n));
          total += n;
          if (total > maxBytes) return { tooLarge: true };
        }
        const bytes = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) {
          bytes.set(c, at);
          at += c.length;
        }
        return { text: new TextDecoder("utf-8").decode(bytes) };
      } catch {
        return undefined;
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
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
        return loadRootRelative(realRoot, fs.realpathSync(abs(file)));
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
    readText(file, maxBytes) {
      const text = table.get(resolve(file));
      if (text === undefined) return undefined;
      return new TextEncoder().encode(text).length > maxBytes ? { tooLarge: true } : { text };
    },
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
      const exists =
        real === "" || table.has(real) || [...table.keys()].some((k) => k.startsWith(`${real}/`));
      return exists ? real || "." : undefined;
    },
  };
}
