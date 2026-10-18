import type { OperationId } from "@seampact/spec/ir";

// Why a target produces no file, with the fix (lesson 2: refuse, never weaken a check).
export interface Refusal {
  code: string;
  message: string;
  fix: string;
  operation?: OperationId;
  // A JSON Pointer into the IR, or into the target options for `parseOptions`.
  member?: string;
}

export interface Refused {
  status: "refused";
  refusals: readonly Refusal[];
}
