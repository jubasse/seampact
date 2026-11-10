// Where the `input-rules` case's cross-member and unnamed rules point on this target's rule library: the body root.
// An overlay whose library has no rule on the whole object replaces this file with the members its rules sit on.
import { type InputRulePointers, ROOT_INPUT_RULE_POINTERS } from "@seampact/http-suite";

export const TARGET_INPUT_RULE_POINTERS: InputRulePointers = ROOT_INPUT_RULE_POINTERS;
