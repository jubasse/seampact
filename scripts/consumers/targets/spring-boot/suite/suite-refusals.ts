// The cases the Spring Boot consumer does not run, by case id, with the reason: app input rules, which Spring Boot
// ships in 1.2.0 (ADR 0028 "Delivery"); it serves every other operation of the reference contract.
import { inputRulesNotYetRefusal } from "../../../../../packages/tools/http-suite/src/index.ts";

export const SPRING_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  ...inputRulesNotYetRefusal("spring-boot", "1.2.0"),
};
