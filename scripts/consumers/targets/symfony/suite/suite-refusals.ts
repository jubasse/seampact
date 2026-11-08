// The cases the Symfony consumer does not run, by case id, with the reason: the paging cases its target refuses or
// fails by a known bug; it serves every other operation of the reference contract it runs cases against.
import { inputRulesNotYetRefusal } from "../../../../../packages/tools/http-suite/src/index.ts";
import { nativePagingRefusals } from "../../../paging-refusals.ts";

export const SYMFONY_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  ...nativePagingRefusals("symfony"),
  ...inputRulesNotYetRefusal("symfony", "1.1.0"),
};
