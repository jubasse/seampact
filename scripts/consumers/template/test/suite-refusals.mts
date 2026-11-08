// The cases this target's consumer refuses, by case id, with the reason the report names: a target bug, or a form
// every Node server refuses by name at generation, deferred after 1.0. A case stays as written and leaves this list
// with the fix or the release that makes it pass. An overlay with a bug of its own replaces
// `target-suite-refusals.mts`.
import { inputRulesNotYetRefusal } from "@seampact/http-suite";
import { TARGET_SUITE_REFUSALS } from "./target-suite-refusals.mjs";

const NODE_REFUSED_FORM =
  "the Node servers refuse this form by name at generation (deferred after 1.0), so the consumer does not serve its api";

// The Node servers refuse the split sort style by name at generation, so they serve no tasksSplitSort api.
const SPLIT_SORT_REFUSED =
  "the Node servers refuse the split sort style by name at generation (paging.sort.style), after 1.0";

export const SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "absolute-urls-from-public-origin": NODE_REFUSED_FORM,
  "optional-auth-refused-credential": NODE_REFUSED_FORM,
  "split-sort-github-pages": SPLIT_SORT_REFUSED,
  // A Node target drops this line when it ships app input rules (1.1.0).
  ...inputRulesNotYetRefusal("this target", "1.1.0"),
  ...TARGET_SUITE_REFUSALS,
};
