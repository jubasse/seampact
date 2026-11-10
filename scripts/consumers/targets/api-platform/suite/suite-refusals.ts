// The cases the API Platform consumer does not run, by case id, with the reason: the changes feed that no PHP target
// serves yet, and the app input rules, which this target refuses by name until 1.2.0 (ADR 0029 "App input rules").
import { inputRulesNotYetRefusal } from "../../../../../packages/tools/http-suite/src/index.ts";
import { nativePagingRefusals } from "../../../paging-refusals.ts";

export const API_PLATFORM_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  ...nativePagingRefusals("api-platform"),
  ...inputRulesNotYetRefusal("api-platform", "1.2.0"),
};
