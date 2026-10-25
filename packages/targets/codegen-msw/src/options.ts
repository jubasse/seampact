import {
  below,
  type NoOptions,
  type ParseOptionsOutcome,
  parseNoOptions,
  type Refusal,
} from "@seampact/codegen-core";

// The MSW target takes no option yet. Checking each request against the contract is a named form that waits: asked
// for, it is refused as not generated yet rather than as an unknown key.
export type MswMockOptions = NoOptions;

const REQUEST_VALIDATION_KEY = "validateRequests";

const REQUEST_VALIDATION_REFUSAL: Refusal = {
  code: "options.validateRequests.unsupported",
  message:
    "The option 'validateRequests' is not generated yet: the mock handlers answer without checking the request against the contract.",
  fix: "Remove 'validateRequests' from the target's `options`; check the request in the test's own resolver meanwhile.",
  member: below({ member: "" }, REQUEST_VALIDATION_KEY).member,
};

export function parseMswMockOptions(raw: unknown): ParseOptionsOutcome<MswMockOptions> {
  const outcome = parseNoOptions(raw);

  if (outcome.status === "parsed") return outcome;

  const refusals = outcome.refusals.map((refusal) =>
    refusal.member === REQUEST_VALIDATION_REFUSAL.member
      ? structuredClone(REQUEST_VALIDATION_REFUSAL)
      : refusal,
  );

  return { status: "refused", refusals };
}
