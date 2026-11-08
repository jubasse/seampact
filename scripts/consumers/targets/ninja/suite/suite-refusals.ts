// The cases the Django Ninja consumer does not run, by case id, with the reason: the paging cases its target refuses or
// fails by a known bug; it serves every other operation of the reference contract it runs cases against.
import { inputRulesNotYetRefusal } from "../../../../../packages/tools/http-suite/src/index.ts";
import { nativePagingRefusals } from "../../../paging-refusals.ts";

export const NINJA_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  ...nativePagingRefusals("ninja"),
  ...inputRulesNotYetRefusal("ninja", "1.1.x"),
};
