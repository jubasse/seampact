import { compareCodeUnits } from "./code-unit-order.js";
import type { Refusal } from "./refusal.js";
import type { GeneratedFile } from "./target.js";

// The writer's own file in each target's output directory; no target may generate it.
export const MANIFEST_FILE_NAME = ".seampact-manifest.json";

// Why a path is not a relative POSIX path that stays inside the output directory, or undefined when it is.
export function unsafePathReason(path: string): string | undefined {
  if (path === "") return "it is empty";

  if (path.includes("\\")) return "it contains a backslash; paths use '/'";

  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "it has an absolute prefix";

  if (path.includes("\0")) return "it contains a NUL character";

  const segments = path.split("/");

  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "it has an empty, '.' or '..' segment";
  }

  return undefined;
}

// The paths seen so far, by exact spelling and by case-folded key.
interface SeenPaths {
  exactPaths: Set<string>;
  fileByFoldedPath: Map<string, string>;
  directoryByFoldedPath: Map<string, string>;
}

// Refuses each unsafe, duplicate or reserved path, else returns the files in code-unit order of path.
export function checkGeneratedPaths(
  files: readonly GeneratedFile[],
): { status: "checked"; files: GeneratedFile[] } | { status: "refused"; refusals: Refusal[] } {
  const refusals: Refusal[] = [];
  const seen: SeenPaths = {
    exactPaths: new Set(),
    fileByFoldedPath: new Map(),
    directoryByFoldedPath: new Map(),
  };

  for (const file of files) {
    const unsafe = unsafePathReason(file.path);
    const reason = unsafe ?? pathRefusalReason(file.path, seen);

    if (reason !== undefined) {
      refusals.push({
        code: "file.path.invalid",
        message: `The target generated the path '${file.path}', and ${reason}.`,
        fix: CASE_AWARE_FIX,
      });
    }

    if (unsafe === undefined) rememberPath(file.path, seen);
  }

  if (refusals.length > 0) return { status: "refused", refusals };

  const sorted = files
    .map((file) => ({ path: file.path, contents: file.contents }))
    .sort((left, right) => compareCodeUnits(left.path, right.path));

  return { status: "checked", files: sorted };
}

const CASE_AWARE_FIX =
  "Report this to the target's maintainers, or, if two paths differ only by letter case, rename one of the two contract names: a target emits distinct relative POSIX paths inside its output root.";

// The key two paths share on a case-insensitive file system. Lower, upper, then lower case: the same answer in
// the four writers (a plain case fold treats the capital sharp s and the dotless i differently), also named in ADR 0015.
export function caseFolded(path: string): string {
  return path.toLowerCase().toUpperCase().toLowerCase();
}

// Each directory of the path, from the outermost: `a/b/c.ts` has `a` and `a/b`.
function directoryPrefixes(path: string): string[] {
  const segments = path.split("/");

  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

function rememberPath(path: string, seen: SeenPaths): void {
  seen.exactPaths.add(path);

  const foldedPath = caseFolded(path);

  if (!seen.fileByFoldedPath.has(foldedPath)) seen.fileByFoldedPath.set(foldedPath, path);

  for (const directory of directoryPrefixes(path)) {
    const foldedDirectory = caseFolded(directory);

    if (!seen.directoryByFoldedPath.has(foldedDirectory)) {
      seen.directoryByFoldedPath.set(foldedDirectory, directory);
    }
  }
}

function pathRefusalReason(path: string, seen: SeenPaths): string | undefined {
  if (seen.exactPaths.has(path)) return "it is generated twice";

  const foldedPath = caseFolded(path);
  const earlierFile = seen.fileByFoldedPath.get(foldedPath);

  if (earlierFile !== undefined) return `it differs only by letter case from '${earlierFile}'`;

  const earlierDirectory = seen.directoryByFoldedPath.get(foldedPath);

  if (earlierDirectory !== undefined) {
    return `it is a file, and an earlier path uses '${earlierDirectory}' as a directory`;
  }

  return directoryRefusalReason(path, seen) ?? manifestRefusalReason(path);
}

function directoryRefusalReason(path: string, seen: SeenPaths): string | undefined {
  for (const directory of directoryPrefixes(path)) {
    const foldedDirectory = caseFolded(directory);
    const fileAtDirectory = seen.fileByFoldedPath.get(foldedDirectory);

    if (fileAtDirectory !== undefined) {
      return `its directory '${directory}' is also the file '${fileAtDirectory}'`;
    }

    const earlierDirectory = seen.directoryByFoldedPath.get(foldedDirectory);

    if (earlierDirectory !== undefined && earlierDirectory !== directory) {
      return `its directory '${directory}' differs only by letter case from the directory '${earlierDirectory}' of an earlier path`;
    }
  }

  return undefined;
}

function manifestRefusalReason(path: string): string | undefined {
  if (path.split("/").at(-1) === MANIFEST_FILE_NAME) {
    return `'${MANIFEST_FILE_NAME}' is the writer's manifest`;
  }

  return undefined;
}
