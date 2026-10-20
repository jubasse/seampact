import type { ContractIR } from "@seampact/spec/ir";
import type { DiffChange, DiffRefusal } from "../result.js";
import { changedPackNames, compareApi, comparePacks } from "./api.js";
import {
  compareEnumCatalogue,
  compareScalarCatalogue,
  compareSchemaCatalogue,
} from "./catalogue.js";
import {
  type ChangeSite,
  compareMembers,
  type MemberComparison,
  type WalkContext,
} from "./context.js";
import { compareWholeEntries, WHOLE_ENTRY_CATALOGUES } from "./declarations.js";
import { compareOperations } from "./operations.js";
import { buildReachIndex } from "./reach.js";
import { ChangeSink, NO_POSITION } from "./sink.js";

// The structural walk of two IRs of one api: every top-level member is compared, by the walk of its own or by
// its row in the member table, so every difference becomes a change or a refusal.

export interface WalkOutcome {
  changes: DiffChange[];
  refusals: readonly DiffRefusal[];
}

export function walkContracts(before: ContractIR, after: ContractIR): WalkOutcome {
  const sink = new ChangeSink(changedPackNames(before.packs, after.packs));
  const context: WalkContext = {
    before,
    after,
    beforeReach: buildReachIndex(before),
    afterReach: buildReachIndex(after),
    sink,
  };
  const site: ChangeSite = { reaches: NO_POSITION };
  const wholeEntryComparisons = Object.fromEntries(
    Object.keys(WHOLE_ENTRY_CATALOGUES).map((catalogue) => [
      catalogue,
      (_pointer: string, beforeValue: unknown, afterValue: unknown) =>
        compareWholeEntries(context, catalogue, recordOf(beforeValue), recordOf(afterValue)),
    ]),
  ) satisfies Record<string, MemberComparison>;

  compareMembers(context, site, "ContractIR", "", before, after, {
    ...wholeEntryComparisons,
    irVersion: () => undefined,
    irRevision: () => undefined,
    api: () => compareApi(context),
    packs: () => comparePacks(context, before.packs, after.packs),
    schemas: () => compareSchemaCatalogue(context),
    scalars: () => compareScalarCatalogue(context),
    enums: () => compareEnumCatalogue(context),
    operations: () => compareOperations(context),
  });

  return { changes: sink.sortedChanges(), refusals: sink.refusals };
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? { ...value } : {};
}
