import {
  type ContractIR,
  type Identity,
  type IdentityHeaderUse,
  isKnownVariant,
  type Principal,
} from "@seampact/spec/ir";
import type { DiffPosition } from "../result.js";
import {
  type ChangeSite,
  compareMembers,
  emitAt,
  type MemberComparison,
  type WalkContext,
} from "./context.js";
import { isRecord, isSameJson, memberNames, pointerJoin } from "./json.js";
import { commonReaches, declarationReachKey } from "./reach.js";
import { type ElementOrigin, NO_POSITION } from "./sink.js";
import { compareBound, compareSchemaRef, compareTypeUse } from "./type-use.js";

// The declaration catalogues (errors, natures, schemes, headers, identities, rights, rules, scopes, buckets,
// services, extension keys, formats and paging styles): an entry held by both IRs is compared member by member and
// classified at the operations reaching it in both; an entry added or removed is classified where an operation
// starts or stops naming it, and reported as `declaration` at no position.

export const DECLARATION_CATALOGUES = {
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

export type DeclarationCatalogue = keyof typeof DECLARATION_CATALOGUES;

export function isDeclarationCatalogue(name: string): name is DeclarationCatalogue {
  return Object.hasOwn(DECLARATION_CATALOGUES, name);
}

const CATALOGUE_DEFINITIONS: Readonly<Record<string, string | Readonly<Record<string, string>>>> =
  DECLARATION_CATALOGUES;

type MemberComparisons = Readonly<Record<string, MemberComparison>>;

export function compareDeclarations(context: WalkContext, catalogue: DeclarationCatalogue): void {
  const before: Readonly<Record<string, unknown>> = context.before[catalogue];
  const after: Readonly<Record<string, unknown>> = context.after[catalogue];

  for (const id of memberNames(before, after)) {
    const beforeEntry = before[id];
    const afterEntry = after[id];
    const pointer = pointerJoin("", catalogue, id);

    if (!isRecord(beforeEntry) || !isRecord(afterEntry)) {
      emitAt(
        context,
        { reaches: NO_POSITION, origin: originOf(afterEntry ?? beforeEntry) },
        {
          kind: "declaration",
          case: isRecord(afterEntry) ? "added" : "removed",
          pointer,
          before: isRecord(beforeEntry) ? id : undefined,
          after: isRecord(afterEntry) ? id : undefined,
        },
      );
      continue;
    }

    const site: ChangeSite = {
      reaches: commonReaches(
        context.beforeReach,
        context.afterReach,
        declarationReachKey(catalogue, id),
      ),
      origin: originOf(afterEntry),
    };

    // A tagged entry of another kind holds other members: the kind change says it all.
    if (
      typeof CATALOGUE_DEFINITIONS[catalogue] !== "string" &&
      beforeEntry.kind !== afterEntry.kind
    ) {
      compareMembers(
        context,
        site,
        definitionOf(catalogue, afterEntry),
        pointer,
        { kind: beforeEntry.kind },
        { kind: afterEntry.kind },
        {},
      );
      continue;
    }

    compareMembers(
      context,
      site,
      definitionOf(catalogue, afterEntry),
      pointer,
      beforeEntry,
      afterEntry,
      entryComparisons(context, site, catalogue, id),
    );
  }
}

// The members compared by a walk of their own; every other member takes its row in the member table.
function entryComparisons(
  context: WalkContext,
  site: ChangeSite,
  catalogue: DeclarationCatalogue,
  id: string,
): MemberComparisons {
  const { before, after } = context;
  const schemaRef =
    (beforeId: string | undefined, afterId: string | undefined) => (pointer: string) =>
      compareSchemaRef(context, site, pointer, beforeId, afterId);

  switch (catalogue) {
    case "errors":
      return { params: schemaRef(before.errors[id]?.params, after.errors[id]?.params) };
    case "rights":
      return {
        params: schemaRef(before.rights[id]?.params, after.rights[id]?.params),
        guest: (pointer) =>
          compareGuest(context, site, pointer, before.rights[id]?.guest, after.rights[id]?.guest),
      };
    case "rules":
      return { params: schemaRef(before.rules[id]?.params, after.rules[id]?.params) };
    case "headers":
      return {
        schema: (pointer) => {
          const beforeSchema = before.headers[id]?.schema;
          const afterSchema = after.headers[id]?.schema;

          if (beforeSchema === undefined || afterSchema === undefined) {
            emitAt(context, site, { kind: "type.changed", case: "kind", pointer });

            return;
          }

          compareTypeUse(context, site, pointer, beforeSchema, afterSchema);
        },
      };
    case "scopes":
      return {
        idSchema: (pointer) => {
          const beforeScope = before.scopes[id];
          const afterScope = after.scopes[id];

          if (beforeScope !== undefined && afterScope !== undefined)
            compareTypeUse(context, site, pointer, beforeScope.idSchema, afterScope.idSchema);
        },
      };
    case "buckets":
      return {
        limit: (pointer) =>
          compareBound(
            context,
            site,
            pointer,
            "upper",
            before.buckets[id]?.limit,
            after.buckets[id]?.limit,
          ),
        // A longer window under the same limit admits fewer requests.
        windowMs: (pointer) =>
          compareBound(
            context,
            site,
            pointer,
            "lower",
            before.buckets[id]?.windowMs,
            after.buckets[id]?.windowMs,
          ),
      };
    case "identities":
      return identityComparisons(context, site, before.identities[id], after.identities[id]);
    case "pagings":
      return pagingStyleComparisons(context, site);
    default:
      return {};
  }
}

// A paging style's request roles are read on input, its page body, absent policy and handler result on output.
function pagingStyleComparisons(context: WalkContext, site: ChangeSite): MemberComparisons {
  const at =
    (memberCase: string, positions: readonly DiffPosition[]) =>
    (pointer: string, before: unknown, after: unknown) =>
      emitAt(
        context,
        { ...site, reaches: site.reaches.filter((reach) => positions.includes(reach.position)) },
        { kind: "pagingStyle", case: memberCase, pointer, before, after },
      );

  return {
    request: at("request", ["input", "none"]),
    response: at("response", ["output", "none"]),
    absent: at("absent", ["output", "none"]),
    handlerResult: at("handlerResult", ["output", "none"]),
  };
}

// A reason edit keeps guests admitted.
function compareGuest(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: unknown,
  after: unknown,
): void {
  if ((before === undefined) === (after === undefined)) {
    emitAt(context, site, { kind: "annotation", case: "guest", pointer });

    return;
  }

  emitAt(context, site, {
    kind: "right",
    case: after === undefined ? "guestRemoved" : "guestAdded",
    pointer,
  });
}

function identityComparisons(
  context: WalkContext,
  site: ChangeSite,
  before: Identity | undefined,
  after: Identity | undefined,
): MemberComparisons {
  if (before === undefined || after === undefined) return {};

  if (!isKnownVariant("Identity", before) || !isKnownVariant("Identity", after)) return {};

  return {
    schemes: (pointer) =>
      compareSchemeLists(
        context,
        site,
        pointer,
        credentialSchemes(before),
        credentialSchemes(after),
      ),
    principal: (pointer) =>
      comparePrincipal(context, site, pointer, before.principal, after.principal),
    headers: (pointer) =>
      compareIdentityHeaders(context, site, pointer, before.headers, after.headers),
  };
}

function credentialSchemes(identity: Identity): string[] {
  if (!isKnownVariant("Identity", identity) || identity.kind !== "credential") return [];

  const { read, write, optionalRead } = identity.schemes;

  return [...new Set([...read, ...write, ...optionalRead])];
}

// A scheme an identity reads is one its clients may send: removing one refuses them, adding one admits more.
function compareSchemeLists(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: readonly string[],
  after: readonly string[],
): void {
  const added = after.filter((scheme) => !before.includes(scheme));
  const removed = before.filter((scheme) => !after.includes(scheme));

  for (const scheme of added)
    emitAt(context, site, { kind: "identity", case: "schemeAdded", pointer, after: scheme });

  for (const scheme of removed)
    emitAt(context, site, { kind: "identity", case: "schemeRemoved", pointer, before: scheme });

  // The same schemes moved between read, write and optional read: which requests each admits changed.
  if (added.length === 0 && removed.length === 0)
    emitAt(context, site, { kind: "identity", case: "schemeRoles", pointer });
}

function comparePrincipal(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: Principal,
  after: Principal,
): void {
  if (
    isKnownVariant("Principal", before) &&
    isKnownVariant("Principal", after) &&
    before.kind === "schema" &&
    after.kind === "schema"
  ) {
    compareSchemaRef(context, site, pointerJoin(pointer, "schema"), before.schema, after.schema);

    return;
  }

  emitAt(context, site, { kind: "identity", case: "principal", pointer });
}

function compareIdentityHeaders(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: readonly IdentityHeaderUse[],
  after: readonly IdentityHeaderUse[],
): void {
  after.forEach((header, index) => {
    if (before.some((candidate) => candidate.header === header.header)) return;

    emitAt(context, site, {
      kind: "identity",
      case: header.required ? "headerAddedRequired" : "headerAddedOptional",
      pointer: pointerJoin(pointer, index),
      after: header.header,
    });
  });

  before.forEach((header, index) => {
    const kept = after.findIndex((candidate) => candidate.header === header.header);
    const afterHeader = after[kept];

    if (afterHeader === undefined) {
      emitAt(context, site, {
        kind: "identity",
        case: "headerRemoved",
        pointer: pointerJoin(pointer, index),
        before: header.header,
      });

      return;
    }

    if (isSameJson(header, afterHeader)) return;

    const { origin: _beforeOrigin, ...beforeUse } = header;
    const { origin: _afterOrigin, ...afterUse } = afterHeader;
    const headerPointer = pointerJoin(pointer, kept);

    emitAt(context, site, {
      kind: isSameJson(beforeUse, afterUse) ? "annotation" : "identity",
      case: isSameJson(beforeUse, afterUse) ? "origin" : "headerChanged",
      pointer: headerPointer,
      after: afterHeader.header,
    });
  });
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
