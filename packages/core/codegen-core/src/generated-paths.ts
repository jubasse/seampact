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

// Refuses each unsafe, duplicate or reserved path, else returns the files in code-unit order of path.
export function checkGeneratedPaths(
  files: readonly GeneratedFile[],
): { status: "checked"; files: GeneratedFile[] } | { status: "refused"; refusals: Refusal[] } {
  const refusals: Refusal[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const reason = pathRefusalReason(file.path, seen);

    if (reason !== undefined) {
      refusals.push({
        code: "file.path.invalid",
        message: `The target generated the path '${file.path}', and ${reason}.`,
        fix: "Report this to the target's maintainers: a target emits distinct relative POSIX paths inside its output root.",
      });
    }

    seen.add(file.path);
  }

  if (refusals.length > 0) return { status: "refused", refusals };

  const sorted = files
    .map((file) => ({ path: file.path, contents: file.contents }))
    .sort((left, right) => compareCodeUnits(left.path, right.path));

  return { status: "checked", files: sorted };
}

function pathRefusalReason(path: string, seen: ReadonlySet<string>): string | undefined {
  const unsafe = unsafePathReason(path);

  if (unsafe !== undefined) return unsafe;

  if (seen.has(path)) return "it is generated twice";

  if (path.split("/").at(-1) === MANIFEST_FILE_NAME)
    return `'${MANIFEST_FILE_NAME}' is the writer's manifest`;

  return undefined;
}
