import type { DraftIR, PassPart } from "../../../pipeline/seam.js";
import { type AccessRightsCatalogues, accessRightsCatalogues } from "./catalogues.js";
import { accessRightsFieldRights, accessRightsRestrictionChecks } from "./field-rights.js";
import { accessRightsFilteredBy } from "./filtered-by.js";
import {
  type AccessRightsDeriveEntry,
  accessRightsDeclareRight,
  accessRightsDeriveEntries,
  accessRightsSelects,
} from "./packs.js";
import { accessRightsMember } from "./read.js";
import { accessRightsReporter } from "./report.js";
import {
  accessRightsCheckRequirementEntries,
  accessRightsItemChecks,
  accessRightsRequirements,
} from "./requires.js";
import { accessRightsApi, accessRightsRoutes } from "./routes.js";
import type { AccessRightsContext } from "./schema-use.js";
import { accessRightsOperationScopes } from "./scopes.js";
import { type AccessRightsSortKeyRights, accessRightsSortKeyRights } from "./sort-keys.js";

// The access.rights half (ADR 0006 sections 2 and 3): the `rights`, `rules`, `scopes` and `buckets` catalogues
// and, per operation, the resolved `scopes`, the ordered `requires` (pack-derived rights and requirements
// included), `fieldRights`, `filteredBy` and the rights of its sort keys. It reads each operation's `id`, `op`,
// `safe`, `origin`, `relays`, input schema, responses and sort keys (tree.nodes), `packs` to name a pack
// derivation, and `schemas` for the principal fields a subject reads and the restricted fields.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export const accessRightsPass: PassPart<"access.rights"> = {
  pass: "access",
  half: "access.rights",
  reads: [
    "packs",
    "schemas",
    "operations[].id",
    "operations[].op",
    "operations[].safe",
    "operations[].origin",
    "operations[].relays",
    "operations[].input.schema",
    "operations[].input.origin",
    "operations[].responses",
    "operations[].paging.sortKeys[].key",
    "operations[].paging.sortKeys[].origin",
  ],
  writes: [
    "rights",
    "rules",
    "scopes",
    "buckets",
    "operations[].scopes",
    "operations[].requires",
    "operations[].fieldRights",
    "operations[].filteredBy",
    "operations[].paging.sortKeys[].right",
    "operations[].paging.sortKeys[].derivedFrom",
  ],
  run: (draft, context) => {
    accessRightsRun(draft, context);
  },
};

function accessRightsRun(draft: DraftIR, context: AccessRightsContext): void {
  const reporter = accessRightsReporter(context);
  const api = accessRightsApi(context);
  const catalogues = accessRightsCatalogues(context, reporter);
  const entries = accessRightsDeriveEntries(context, draft.packs);
  const routes = accessRightsRoutes(draft, context, api).map((route) => ({
    route,
    scopes: accessRightsOperationScopes(context, reporter, catalogues, route.node),
  }));

  // Every pack-derived right is declared before any requirement names one.
  for (const { route, scopes } of routes)
    for (const entry of entriesWith(entries, "declareRight"))
      if (accessRightsSelects(context, entry, route, api))
        accessRightsDeclareRight(context, reporter, catalogues, {
          entry,
          route,
          scopes,
          schemas: draft.schemas,
        });

  const checks = accessRightsItemChecks();
  const restrictions = accessRightsRestrictionChecks();

  accessRightsCheckRequirementEntries(context, reporter, catalogues, checks);
  const built = routes.map(({ route, scopes }) => ({
    scopes,
    requires: accessRightsRequirements(context, reporter, catalogues, checks, {
      route,
      scopes,
      api,
      entries,
      schemas: draft.schemas,
    }),
    fieldRights: accessRightsFieldRights(context, reporter, catalogues, restrictions, {
      route,
      scopes,
      schemas: draft.schemas,
    }),
    filteredBy: accessRightsFilteredBy(reporter, catalogues, route),
    sortKeys: accessRightsSortKeyRights(context, reporter, catalogues, restrictions, {
      route,
      schemas: draft.schemas,
    }),
  }));

  writeCatalogues(draft, catalogues);

  // `accessRightsRoutes` maps the draft's operations in order, so the two lists pair by index.
  for (const [index, operation] of draft.operations.entries()) {
    const members = built[index];

    if (members === undefined)
      throw new Error(`access.rights built no route for operation ${operation.id ?? index}`);
    operation.scopes = members.scopes;
    operation.requires = members.requires;
    operation.fieldRights = members.fieldRights;

    if (members.filteredBy !== undefined) operation.filteredBy = members.filteredBy;

    writeSortKeyRights(operation, members.sortKeys);
  }
}

function writeSortKeyRights(
  operation: DraftIR["operations"][number],
  rights: AccessRightsSortKeyRights,
): void {
  for (const [index, { right, derivedFrom }] of rights) {
    const sortKey = operation.paging?.sortKeys[index];

    if (sortKey === undefined)
      throw new Error(`access.rights found no sort key ${index} on operation ${operation.id}`);
    sortKey.right = right;

    if (derivedFrom !== undefined) sortKey.derivedFrom = derivedFrom;
  }
}

const entriesWith = (
  entries: readonly AccessRightsDeriveEntry[],
  effect: string,
): AccessRightsDeriveEntry[] =>
  entries.filter((entry) => accessRightsMember(entry.settings, effect) !== undefined);

function writeCatalogues(draft: DraftIR, catalogues: AccessRightsCatalogues): void {
  for (const [id, right] of catalogues.rights) draft.rights[id] = right;

  for (const [id, rule] of catalogues.rules) draft.rules[id] = rule;

  for (const [id, scope] of catalogues.scopes) draft.scopes[id] = scope;

  for (const [id, bucket] of catalogues.buckets) draft.buckets[id] = bucket;
}
