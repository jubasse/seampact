import type { DraftIR, PassPart } from "../../../pipeline/seam.js";
import { type AccessRightsCatalogues, accessRightsCatalogues } from "./catalogues.js";
import {
  type AccessRightsDeriveEntry,
  accessRightsDeclareRight,
  accessRightsDeriveEntries,
  accessRightsSelects,
} from "./packs.js";
import { accessRightsMember } from "./read.js";
import { accessRightsReporter } from "./report.js";
import { accessRightsItemChecks, accessRightsRequirements } from "./requires.js";
import { accessRightsApi, accessRightsRoutes } from "./routes.js";
import type { AccessRightsContext } from "./schema-use.js";
import { accessRightsOperationScopes } from "./scopes.js";

// The access.rights half (ADR 0006 sections 2 and 3): the `rights`, `rules`, `scopes` and `buckets` catalogues
// and, per operation, the resolved `scopes` and the ordered `requires`, pack-derived rights and requirements
// included. It reads each operation's `id`, `op`, `safe` and `origin` (tree.nodes), `packs` to name a pack
// derivation, and `schemas` for the principal fields a subject reads.
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
  ],
  writes: ["rights", "rules", "scopes", "buckets", "operations[].scopes", "operations[].requires"],
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
  const requirements = routes.map(({ route, scopes }) =>
    accessRightsRequirements(context, reporter, catalogues, checks, {
      route,
      scopes,
      api,
      entries,
      schemas: draft.schemas,
    }),
  );

  writeCatalogues(draft, catalogues);
  for (const [index, { scopes }] of routes.entries()) {
    const operation = draft.operations[index];
    if (operation === undefined) continue;
    operation.scopes = scopes;
    operation.requires = requirements[index] ?? [];
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
