import type { ContractIR } from "@seampact/spec/ir";
import { type ChangeSite, compareMembers, emitAt, type WalkContext } from "./context.js";
import { isRecord, memberNames, pointerJoin } from "./json.js";
import { type ElementOrigin, NO_POSITION } from "./sink.js";

// The catalogues the table has no rows for yet (errors, natures, schemes, headers, identities, rights, rules,
// scopes, buckets, services, extension keys, formats and paging styles): each entry added, removed or changed
// outside its annotations is `unclassified`, so `additive-only` fails naming it until its rows land.

export const WHOLE_ENTRY_CATALOGUES = {
  errors: "ErrorDecl",
  natures: "NatureDecl",
  schemes: {
    cookie: "CookieScheme",
    header: "HeaderScheme",
    query: "QueryScheme",
    bearer: "BearerScheme",
    basic: "BasicScheme",
    signature: "SignatureScheme",
  },
  headers: "HeaderDecl",
  identities: { credential: "CredentialIdentity", signed: "SignedIdentity" },
  rights: "Right",
  rules: "Rule",
  scopes: "Scope",
  buckets: "Bucket",
  services: "Service",
  extensionKeys: "ExtensionKeyDecl",
  formats: "WireFormat",
  pagings: "PagingStyle",
} as const satisfies Partial<Record<keyof ContractIR, string | Readonly<Record<string, string>>>>;

const CATALOGUE_DEFINITIONS: Readonly<Record<string, string | Readonly<Record<string, string>>>> =
  WHOLE_ENTRY_CATALOGUES;

export function compareWholeEntries(
  context: WalkContext,
  catalogue: string,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): void {
  for (const id of memberNames(before, after)) {
    const beforeEntry = before[id];
    const afterEntry = after[id];
    const pointer = pointerJoin("", catalogue, id);
    const site: ChangeSite = { reaches: NO_POSITION, origin: originOf(afterEntry ?? beforeEntry) };

    if (!isRecord(beforeEntry) || !isRecord(afterEntry)) {
      emitAt(context, site, {
        kind: "unclassified",
        case: `ContractIR.${catalogue}`,
        pointer,
        before: isRecord(beforeEntry) ? id : undefined,
        after: isRecord(afterEntry) ? id : undefined,
      });
      continue;
    }

    compareMembers(
      context,
      site,
      definitionOf(catalogue, afterEntry),
      pointer,
      beforeEntry,
      afterEntry,
      {},
    );
  }
}

// The definition of an entry, by its `kind` for the tagged catalogues; a kind of another revision names none.
function definitionOf(catalogue: string, entry: Record<string, unknown>): string {
  const definition = CATALOGUE_DEFINITIONS[catalogue] ?? catalogue;

  if (typeof definition === "string") return definition;

  const kind = entry.kind;

  return (
    (typeof kind === "string" && Object.hasOwn(definition, kind) ? definition[kind] : undefined) ??
    catalogue
  );
}

function originOf(entry: unknown): ElementOrigin | undefined {
  if (!isRecord(entry) || !isRecord(entry.origin)) return undefined;

  const { layer } = entry.origin;

  return typeof layer === "string" ? { layer } : undefined;
}
