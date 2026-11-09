// The cases beyond the shared ones the NestJS consumer refuses: on class-validator, the `input-rules` case, whose
// cross-member and unnamed rules point at the body root. class-validator has no class-level constraint, so those
// rules sit on a member and point at it; the other validator libraries run the case. The rules module defines
// decorated classes on class-validator, so the metadata polyfill loads first, as in the server.
import "reflect-metadata";
import { INPUT_RULES_CASE_ID } from "@seampact/http-suite";
import { inputRules } from "../src/input-rules.mjs";

const RULES_ARE_CLASSES = typeof inputRules.scheduleTask.body === "function";

export const TARGET_SUITE_REFUSALS: Readonly<Record<string, string>> = RULES_ARE_CLASSES
  ? {
      [INPUT_RULES_CASE_ID]:
        "class-validator has no class-level constraint, so a cross-member rule points at a member, not the body root",
    }
  : {};
