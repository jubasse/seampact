// The cases this target's consumer refuses, by case id, with the target bug the report names: a case stays as
// written and leaves this list with the fix that makes it pass. An overlay with a bug of its own replaces
// `target-suite-refusals.mts`.
import { TARGET_SUITE_REFUSALS } from "./target-suite-refusals.mjs";

const NO_FRAMEWORK_ROUTE_CHECK =
  "no Node server target checks framework routes outside the contract at boot, and the CLI refuses the 'frameworkRoutes' entry of a target (config.key.waits) that allow-lists one";

export const SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "unlisted-framework-route-fails-boot": NO_FRAMEWORK_ROUTE_CHECK,
  "allow-listed-framework-route-boots": NO_FRAMEWORK_ROUTE_CHECK,
  ...TARGET_SUITE_REFUSALS,
};
