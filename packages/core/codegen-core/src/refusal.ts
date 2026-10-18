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

export function refused(refusals: readonly Refusal[]): Refused {
  return { status: "refused", refusals };
}

// A form shared by several operations, such as an error code's params, is refused once.
export function withoutRepeats(refusals: readonly Refusal[]): Refusal[] {
  const seen = new Set<string>();

  return refusals.filter((refusal) => {
    const key = JSON.stringify([refusal.code, refusal.member, refusal.operation]);

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}
