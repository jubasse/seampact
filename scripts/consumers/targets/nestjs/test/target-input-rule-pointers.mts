// Where the `input-rules` case's cross-member and unnamed rules point on this consumer's rule library. class-validator
// has no rule on the whole object, so its rules sit on `start` and `note` and point there; zod and yup point at the
// body root. The rules module defines decorated classes on class-validator, so the metadata polyfill loads first, as
// in the server.
import "reflect-metadata";
import { type InputRulePointers, ROOT_INPUT_RULE_POINTERS } from "@seampact/http-suite";
import { inputRules } from "../src/input-rules.mjs";

const RULES_ARE_CLASSES = typeof inputRules.scheduleTask.body === "function";

export const TARGET_INPUT_RULE_POINTERS: InputRulePointers = RULES_ARE_CLASSES
  ? { crossMember: "/start", unnamed: "/note" }
  : ROOT_INPUT_RULE_POINTERS;
