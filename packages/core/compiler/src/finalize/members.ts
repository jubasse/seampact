import { IR_REVISION, IR_VERSION, type IrWriter } from "@seampact/spec/ir";
import type { DraftOperation } from "../pipeline/seam.js";
import { finalizeCompareText } from "./canonical-order.js";

// The members finalize writes (ADR 0005 sections 2 and 3, ADR 0006 section 3): `irVersion`, `irRevision`, the
// declaration `kinds` present, and the must-understand `features` each operation uses, with their union on top.

/** One must-understand feature: its name and whether an operation of the complete draft uses it. */
export interface FinalizeFeatureRow {
  readonly feature: IrWriter.Feature;
  readonly usedBy: (operation: DraftOperation) => boolean;
}

/** The member-to-feature table: empty at this irRevision, since every member is understood by every target. */
export const FINALIZE_FEATURE_TABLE: readonly FinalizeFeatureRow[] = [];

/** The top-level members finalize writes. */
export interface FinalizeMembers {
  readonly irVersion: number;
  readonly irRevision: number;
  readonly kinds: IrWriter.DeclarationKind[];
  readonly features: IrWriter.Feature[];
}

/** The features an operation uses, sorted, each once. */
export function finalizeOperationFeatures(
  operation: DraftOperation,
  featureTable: readonly FinalizeFeatureRow[] = FINALIZE_FEATURE_TABLE,
): IrWriter.Feature[] {
  const used = featureTable.filter((row) => row.usedBy(operation)).map((row) => row.feature);

  return [...new Set(used)].sort(finalizeCompareText);
}

/** The top-level members, from the operations once each carries its `features`. */
export function finalizeMembers(
  operations: readonly { readonly features: readonly IrWriter.Feature[] }[],
): FinalizeMembers {
  const features = [...new Set(operations.flatMap((operation) => operation.features))];
  // An operation is an `httpOperation`, the one declaration kind of this irVersion (ADR 0004 section 2).
  const kinds: IrWriter.DeclarationKind[] = operations.length > 0 ? ["httpOperation"] : [];

  return {
    irVersion: IR_VERSION,
    irRevision: IR_REVISION,
    kinds,
    features: features.sort(finalizeCompareText),
  };
}
