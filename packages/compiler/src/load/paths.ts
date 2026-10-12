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

/** `boundary` "." is the workspace root. */
export function isInside(boundary: string, file: string): boolean {
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
  if (target.startsWith("/") || /^[A-Za-z]:/.test(target)) return "absolute";
  const resolved = joinPath(dirnameOf(fromFile), target);
  if (!isInside(boundary, resolved)) return "escape";
  return { path: resolved, fragment };
}

export type CaseCheck = { kind: "ok" } | { kind: "missing" } | { kind: "case"; actual: string };

/** Checks every segment against the directory listing, so a case-insensitive disk cannot hide a mismatch. */
export function checkCase(reader: LoadReader, file: string): CaseCheck {
  let current = "";
  const actual: string[] = [];
  let mismatch = false;
  for (const seg of file.split("/")) {
    if (seg === "..") {
      current = current === "" ? ".." : `${current}/..`;
      actual.push(seg);
      continue;
    }
    const entries = reader.listDir(current === "" ? "." : current);
    if (!entries) return { kind: "missing" };
    if (entries.includes(seg)) {
      actual.push(seg);
    } else {
      const folded = entries.filter((e) => e.toLowerCase() === seg.toLowerCase()).sort();
      const hit = folded[0];
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

export function pointerEscape(seg: string): string {
  return seg.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function pointerSegments(pointer: string): string[] | undefined {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return undefined;
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
}
