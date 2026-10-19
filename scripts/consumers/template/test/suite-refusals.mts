// The cases this target's consumer refuses, by case id, with the target bug the report names: a case stays as
// written and leaves this list with the fix that makes it pass. An overlay with a bug of its own replaces
// `target-suite-refusals.mts`.
import { TARGET_SUITE_REFUSALS } from "./target-suite-refusals.mjs";

export const SUITE_REFUSALS: Readonly<Record<string, string>> = {
  ...TARGET_SUITE_REFUSALS,
};
