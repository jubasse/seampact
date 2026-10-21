import { derivationRoles, diagnosticLocationKey, type PipelineApiResult } from "@seampact/compiler";
import type { EditorCatalogue } from "./name-positions.js";

/** One catalogue entry an api declares, with the file and line its winning layer writes it at. */
export interface EditorDeclaration {
  readonly catalogue: string;
  readonly name: string;
  /** Relative to the workspace root, with forward slashes. */
  readonly file: string;
  readonly line: number;
}

/** The names a position may take: each name with the sentence an editor shows beside it. */
export type EditorNames = ReadonlyMap<EditorCatalogue, ReadonlyMap<string, string>>;

/** Every entry the api's layers declare, located in the api's side table. */
export function editorDeclarations(
  api: Pick<PipelineApiResult, "api" | "declared" | "locations">,
): EditorDeclaration[] {
  return (api.declared ?? []).map(({ catalogue, id, origin }) => {
    const key = diagnosticLocationKey(origin);
    const location = Object.hasOwn(api.locations, key) ? api.locations[key] : undefined;

    // The load stage locates every key it merges, so a declaration without a location is a compiler bug.
    if (location === undefined)
      throw new Error(`the ${catalogue} entry ${id} of api ${api.api} has no location (${key})`);

    return { catalogue, name: id, file: location.file, line: location.line };
  });
}

/**
 * The names of each catalogue, sorted by code unit, from the declarations of every api of a workspace; the error
 * codes the compiler supplies (the default code of each derivation role) are names too.
 */
export function editorNames(declarations: readonly EditorDeclaration[]): EditorNames {
  const sitesByName = new Map<EditorCatalogue, Map<string, EditorDeclaration[]>>();

  for (const declaration of declarations) {
    if (!isEditorCatalogue(declaration.catalogue)) continue;
    const byName = sitesByName.get(declaration.catalogue) ?? new Map<string, EditorDeclaration[]>();

    sitesByName.set(declaration.catalogue, byName);
    byName.set(declaration.name, [...(byName.get(declaration.name) ?? []), declaration]);
  }

  const names = new Map<EditorCatalogue, Map<string, string>>();

  for (const [catalogue, byName] of sitesByName)
    names.set(
      catalogue,
      new Map([...byName].map(([name, sites]) => [name, declaredSentence(sites)])),
    );

  addCoreErrorCodes(names);

  return new Map([...names].map(([catalogue, byName]) => [catalogue, sortedByName(byName)]));
}

// One api's layers win per name, but two apis may each declare it: every distinct site is named, in file then
// line order.
function declaredSentence(sites: readonly EditorDeclaration[]): string {
  const distinct = new Map(sites.map((site) => [`${site.file}\u0000${site.line}`, site]));
  const ordered = [...distinct.values()].sort(
    (left, right) => compareText(left.file, right.file) || left.line - right.line,
  );

  return `Declared in ${ordered.map(siteDescription).join("; ")}.`;
}

const PACK_FILE = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//;

// A pack's file path depends on where node_modules is installed: name the pack instead.
function siteDescription(site: EditorDeclaration): string {
  const pack = PACK_FILE.exec(site.file)?.[1];

  return pack === undefined ? `${site.file} line ${site.line}` : `the pack ${pack}`;
}

const EDITOR_CATALOGUES: ReadonlySet<string> = new Set<EditorCatalogue>([
  "identities",
  "rights",
  "requirements",
  "enums",
  "errors",
  "pagings",
  "schemas",
]);

function isEditorCatalogue(catalogue: string): catalogue is EditorCatalogue {
  return EDITOR_CATALOGUES.has(catalogue);
}

function addCoreErrorCodes(names: Map<EditorCatalogue, Map<string, string>>): void {
  const errors = names.get("errors") ?? new Map<string, string>();

  for (const { role, defaultCode } of derivationRoles) {
    const supplied = `Supplied by seampact: the default code of the ${role} role.`;
    const declared = errors.get(defaultCode);

    errors.set(defaultCode, declared === undefined ? supplied : `${declared} ${supplied}`);
  }

  names.set("errors", errors);
}

// Code-unit order, the same on every OS and locale.
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedByName(byName: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  return new Map([...byName].sort(([left], [right]) => compareText(left, right)));
}
