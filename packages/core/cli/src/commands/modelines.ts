import { dirname, relative, sep } from "node:path";
import type { LoadResult } from "@seampact/compiler";
import { type AuthoringFile, authoringSchemaFileName } from "@seampact/spec/authoring";

// The comment an editor reads to pick a file's schema (grammar section 3); `compile` never reads it.
const MODELINE_PREFIX = "# yaml-language-server:";

const YAML_FILE = /\.ya?ml$/;
const INSTALLED_PACKAGES = "node_modules/";
const PACK_LAYER_PREFIX = "pack:";

/** Where the installed `@seampact/spec` keeps its authoring schemas, below the app root (`--editor-schemas=none`). */
export const INSTALLED_AUTHORING_SCHEMAS = "node_modules/@seampact/spec/schemas/authoring";

/** The modeline of `file` (absolute) pointing at the schema of `kind` in `schemaDirectory`, relative to the file. */
export function modelineOf(file: string, schemaDirectory: string, kind: AuthoringFile): string {
  const directory = relative(dirname(file), schemaDirectory).split(sep).join("/");
  const schema = authoringSchemaFileName(kind);

  return `${MODELINE_PREFIX} $schema=${directory === "" ? schema : `${directory}/${schema}`}`;
}

/** The text with `modeline` as its first line: it replaces a modeline already there, else comes before the text. */
export function withModeline(text: string, modeline: string): string {
  const lineEnd = text.includes("\r\n") ? "\r\n" : "\n";

  if (!text.startsWith(MODELINE_PREFIX)) return `${modeline}${lineEnd}${text}`;

  const firstLineEnd = text.indexOf(lineEnd);

  return firstLineEnd === -1 ? `${modeline}${lineEnd}` : `${modeline}${text.slice(firstLineEnd)}`;
}

/** A file of the workspace that gets no modeline, and why. */
export interface FileLeftOut {
  readonly file: string;
  readonly reason: string;
}

export interface WorkspaceFileKinds {
  /** Root-relative file to the authoring schema it is checked against. */
  readonly kinds: ReadonlyMap<string, AuthoringFile>;
  readonly leftOut: readonly FileLeftOut[];
}

// Each file the load read, with its kind: the entry `workspace.yaml`, an api file, a base (the shared file or an
// api's base), a pack of the workspace, then each included file by the kind its include site expects.
export function workspaceFileKinds(
  load: Pick<LoadResult, "workspace" | "files" | "fragments">,
): WorkspaceFileKinds {
  const candidates = new Map<string, Set<AuthoringFile | undefined>>();
  const partial = new Set<string>();
  const add = (file: string, kind: AuthoringFile | undefined) =>
    candidates.set(file, (candidates.get(file) ?? new Set()).add(kind));

  if (load.workspace.entry !== undefined) add(load.workspace.entry.file, "workspace");

  for (const api of load.workspace.apis) {
    for (const layer of api.layers) add(layer.file, layerFileKind(layer.layer));
  }

  for (const fragment of load.fragments) {
    if (fragment.pointer === undefined) add(fragment.file, fragment.kind);
    else partial.add(fragment.file);
  }

  const kinds = new Map<string, AuthoringFile>();
  const leftOut: FileLeftOut[] = [];

  for (const file of load.files) {
    const outcome = singleKind(file, candidates.get(file), partial);

    if ("reason" in outcome) leftOut.push({ file, reason: outcome.reason });
    else kinds.set(file, outcome.kind);
  }

  return { kinds, leftOut };
}

function layerFileKind(layer: string): AuthoringFile {
  if (layer === "api") return "api";

  return layer.startsWith(PACK_LAYER_PREFIX) ? "pack" : "base";
}

// The one kind a file is checked against, or why it has none.
function singleKind(
  file: string,
  kinds: ReadonlySet<AuthoringFile | undefined> | undefined,
  partial: ReadonlySet<string>,
): { kind: AuthoringFile } | { reason: string } {
  if (file.startsWith(INSTALLED_PACKAGES) || file.includes(`/${INSTALLED_PACKAGES}`))
    return { reason: "an installed package" };

  if (!YAML_FILE.test(file)) return { reason: "not a YAML file, so it holds no comment" };

  if (partial.has(file))
    return { reason: "included in part, so no one schema checks the whole file" };

  const [kind, ...others] = kinds ?? [];

  if (kind === undefined || others.length > 0)
    return { reason: "its include sites expect no single kind" };

  return { kind };
}
