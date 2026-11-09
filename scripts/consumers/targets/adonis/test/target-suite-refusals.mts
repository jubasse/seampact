// The cases beyond the shared ones the AdonisJS consumer refuses: the `input-rules` case, until the AdonisJS
// target implements app input rules (1.1.0, ADR 0028 "Delivery"). The consumer then drops this file.
import { inputRulesNotYetRefusal } from "@seampact/http-suite";

export const TARGET_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  ...inputRulesNotYetRefusal("AdonisJS", "1.1.0"),
};
