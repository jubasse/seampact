// The compatibility diff of two contract IRs: the classification table, the release gate and the deprecation report.

export { DIFF_CODES, type DiffCode } from "./diff-codes.js";
export { diffContractSets, diffContracts } from "./diff-contracts.js";
export type { DiffExemption, DiffGateScope, DiffOptions } from "./options.js";
export { formatDiffReport } from "./report/format.js";
export type {
  DeprecationEntry,
  DiffBreak,
  DiffChange,
  DiffClassification,
  DiffPosition,
  DiffRefusal,
  DiffResult,
  DiffSide,
  DiffValue,
  GateFailure,
  OperationDeprecationStatus,
} from "./result.js";
export { DIFF_TABLE, type DiffKind } from "./table/rows.js";

export const PACKAGE_NAME = "@seampact/diff";
