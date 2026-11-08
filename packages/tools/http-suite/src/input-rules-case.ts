// The `input-rules` case (ADR 0028 "Tests") and how a server consumer that does not implement app input rules yet
// skips it by name. A consumer opts in by compiling the case's contract (`contracts/input-rules`) as a second source,
// registering the rules and dropping the entry from its suite refusals.

/** The id of the shipped case that proves app input rules. */
export const INPUT_RULES_CASE_ID = "input-rules";

/** The refusal entry of a consumer whose target ships app input rules in [release]: [INPUT_RULES_CASE_ID], with its reason. */
export function inputRulesNotYetRefusal(
  target: string,
  release: string,
): Readonly<Record<string, string>> {
  return {
    [INPUT_RULES_CASE_ID]: `${target} does not implement app input rules before ${release}`,
  };
}
