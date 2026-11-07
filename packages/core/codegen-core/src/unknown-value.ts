import type { OperationId } from "@seampact/spec/ir";
import type { Refusal } from "./refusal.js";

// The refusal a target returns when it must act on an open-enum value it does not know (ADR 0005 section 3
// item 2): it names the value, the member and the operation, and never guesses or skips.
export function refuseUnknownValue(
  member: string,
  value: string,
  operation?: OperationId,
): Refusal {
  const where = operation === undefined ? "" : ` in operation '${operation}'`;

  return {
    code: "ir.value.unknown",
    message: `The value '${value}' of ${member}${where} is not one this target knows.`,
    fix: "Update the target to a release that supports this value, or change the contract so it is not used.",
    member,
    ...(operation === undefined ? {} : { operation }),
  };
}
