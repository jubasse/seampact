// The cases this target's consumer refuses, by case id, with the target bug the report names: a case stays as
// written and leaves this list with the fix that makes it pass. Every Node target refuses the batch read until it
// answers a table keyed by id; an overlay with a bug of its own replaces `target-suite-refusals.mts`.
import { TARGET_SUITE_REFUSALS } from "./target-suite-refusals.mjs";

export const SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "batch-read-without-csrf-or-key":
    "the batch read answers a JSON array of items, where the contract's table is an object keyed by the requested ids (the outgoing check and the generated output type treat it as a list)",
  ...TARGET_SUITE_REFUSALS,
};
