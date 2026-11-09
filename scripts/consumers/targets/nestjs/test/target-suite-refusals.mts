// The cases beyond the shared ones the NestJS consumer refuses: the `input-rules` case, until the NestJS
// target implements app input rules (1.1.0, ADR 0028 "Delivery"). The consumer then drops this file.
import { inputRulesNotYetRefusal } from "@seampact/http-suite";

export const TARGET_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  ...inputRulesNotYetRefusal("NestJS", "1.1.0"),
};
