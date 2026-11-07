import type { AuthoringFile } from "@seampact/spec/authoring";
import type { SiteLocation } from "./report.js";

/**
 * One file an include site or a file `$ref` brings into the workspace, with the kind of mapping
 * that site expects (ADR 0002 section 3): the authoring schema an editor checks the file against.
 */
export interface LoadFragment {
  /** The included file, relative to the workspace root, as the locations name files. */
  readonly file: string;
  /** The JSON Pointer after the path's `#`, when the site includes part of the file. */
  readonly pointer?: string;
  /** Undefined when the site's position names no single authoring file. */
  readonly kind: AuthoringFile | undefined;
  /** Where the path is written. */
  readonly at: SiteLocation;
}

/** The fragments by file, pointer, then site; one entry per distinct site and kind. */
export function loadSortFragments(fragments: readonly LoadFragment[]): LoadFragment[] {
  const unique = new Map<string, LoadFragment>();

  for (const fragment of fragments) unique.set(fragmentKey(fragment), fragment);

  return [...unique.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, fragment]) => fragment);
}

// Wide enough for any line or column a load budget admits.
const SITE_DIGITS = 10;

// Sortable as text: each part is fixed-width or separated by a character no path holds.
function fragmentKey(fragment: LoadFragment): string {
  const { file, pointer, at, kind } = fragment;
  const position = [at.line, at.column].map((n) => String(n).padStart(SITE_DIGITS, "0")).join(":");

  return [file, pointer ?? "", at.file, position, kind ?? ""].join("\u0000");
}
