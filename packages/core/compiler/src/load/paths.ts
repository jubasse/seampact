import type { LoadReader } from "./reader.js";

// ADR 0002 section 1: paths are relative to the containing file, use forward slashes, stay
// inside the boundary (the workspace root, or a pack's package directory) and match the case
// of the file on disk.

export function loadNormalizePath(p: string): string {
  const parts: string[] = [];

  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;

    if (seg === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(seg);
  }

  return parts.length === 0 ? "." : parts.join("/");
}

export function dirnameOf(file: string): string {
  const i = file.lastIndexOf("/");

  return i < 0 ? "." : file.slice(0, i);
}

export function joinPath(dir: string, rel: string): string {
  return loadNormalizePath(dir === "." ? rel : `${dir}/${rel}`);
}

/** An absolute path in any of its forms: POSIX, UNC (`//host/share`) or a drive (`D:`). */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:/.test(p);
}

/**
 * `boundary` "." is the workspace root. `file` is root-relative; a reader gives an absolute path
 * for a real path it cannot express from the root (another drive, a UNC share), and an absolute
 * path is never inside.
 */
export function isInside(boundary: string, file: string): boolean {
  if (isAbsolutePath(file)) return false;

  if (boundary === ".") return file !== ".." && !file.startsWith("../");

  return file === boundary || file.startsWith(`${boundary}/`);
}

export type PathProblem = "absolute" | "backslash" | "escape" | "empty";

export interface ResolvedPath {
  path: string;
  fragment: string | undefined;
}

/** Resolves `raw` (`path` or `path#/pointer`) against the file that contains it. */
export function resolveAuthoredPath(
  fromFile: string,
  raw: string,
  boundary: string,
): ResolvedPath | PathProblem {
  const hash = raw.indexOf("#");
  const target = hash < 0 ? raw : raw.slice(0, hash);
  const fragment = hash < 0 ? undefined : raw.slice(hash + 1);

  if (target === "") return "empty";

  if (target.includes("\\")) return "backslash";

  if (isAbsolutePath(target)) return "absolute";
  const resolved = joinPath(dirnameOf(fromFile), target);

  if (!isInside(boundary, resolved)) return "escape";

  return { path: resolved, fragment };
}

export type CaseCheck =
  | { kind: "ok" }
  | { kind: "missing" }
  | { kind: "escape" }
  | { kind: "case"; actual: string };

/**
 * Checks every segment below `boundary` against the directory listing, so a case-insensitive
 * disk cannot hide a mismatch. `inside` is asked about each directory before it is listed, so a
 * directory reached through a link that leaves the boundary is never listed. `file` is inside
 * `boundary` (lexically), and the boundary itself was built by the loader.
 */
// A listing's names, and per lowercase name the first in sorted order, built once per listing: a
// directory named by many paths is searched in constant time (the store hands out one array).
const listingIndexes = new WeakMap<
  readonly string[],
  { names: Set<string>; folded: Map<string, string> }
>();

function listingIndex(entries: readonly string[]) {
  let index = listingIndexes.get(entries);

  if (!index) {
    const folded = new Map<string, string>();

    for (const e of [...entries].sort()) {
      const k = e.toLowerCase();

      if (!folded.has(k)) folded.set(k, e);
    }

    index = { names: new Set(entries), folded };
    listingIndexes.set(entries, index);
  }

  return index;
}

export function checkCase(
  reader: LoadReader,
  file: string,
  boundary: string,
  inside: (dir: string) => boolean,
): CaseCheck {
  let current = boundary === "." ? "" : boundary;
  const actual: string[] = current === "" ? [] : [current];
  let mismatch = false;
  const rest = current === "" ? file : file.slice(current.length + 1);

  for (const seg of rest.split("/")) {
    const dir = current === "" ? "." : current;

    if (!inside(dir)) return { kind: "escape" };
    const entries = reader.listDir(dir);

    if (!entries) return { kind: "missing" };
    const index = listingIndex(entries);

    if (index.names.has(seg)) {
      actual.push(seg);
    } else {
      const hit = index.folded.get(seg.toLowerCase());

      if (hit === undefined) return { kind: "missing" };
      actual.push(hit);
      mismatch = true;
      current = current === "" ? hit : `${current}/${hit}`;
      continue;
    }

    current = current === "" ? seg : `${current}/${seg}`;
  }

  return mismatch ? { kind: "case", actual: actual.join("/") } : { kind: "ok" };
}

export function pointerSegments(pointer: string): string[] | undefined {
  if (pointer === "") return [];

  if (!pointer.startsWith("/")) return undefined;

  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
}
