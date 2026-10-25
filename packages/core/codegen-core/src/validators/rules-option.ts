import { below } from "../ir-location.js";
import type { Refusal } from "../refusal.js";
import type { ParseOptionsOutcome } from "../target.js";

// `native` renders the validator library's own rule wherever it has one, so the library behaves as its users know
// it; `seampact-consistent` renders the generated checks, which give the contract's verdict on every target.
export const RULES_MODES = ["native", "seampact-consistent"] as const;

export type RulesMode = (typeof RULES_MODES)[number];

export interface ValidatorsOptions {
  readonly rules: RulesMode;
}

export const RULES_KEY = "rules";

export const DEFAULT_VALIDATORS_OPTIONS: ValidatorsOptions = { rules: "native" };

// Accepts `{}` and `rules: native | seampact-consistent`; any other key or value is refused by name.
export function parseValidatorsOptions(raw: unknown): ParseOptionsOutcome<ValidatorsOptions> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      status: "refused",
      refusals: [
        {
          code: "options.invalid",
          message: "The target options are not an object.",
          fix: "Write the target's `options` as an object, or leave it out.",
          member: "",
        },
      ],
    };
  }

  const refusals = Object.keys(raw)
    .filter((key) => key !== RULES_KEY)
    .map(refuseUnknownOption);
  const rules = Object.hasOwn(raw, RULES_KEY)
    ? Object.getOwnPropertyDescriptor(raw, RULES_KEY)?.value
    : DEFAULT_VALIDATORS_OPTIONS.rules;

  if (!isRulesMode(rules)) {
    refusals.push({
      code: "options.rules.invalid",
      message: `The option 'rules' is ${JSON.stringify(rules)}, not one of ${RULES_MODES.join(", ")}.`,
      fix: "Set 'rules' to 'native' (the default) or 'seampact-consistent'.",
      member: `/${RULES_KEY}`,
    });
  }

  if (refusals.length > 0 || !isRulesMode(rules)) return { status: "refused", refusals };

  return { status: "parsed", options: { rules } };
}

function isRulesMode(value: unknown): value is RulesMode {
  return RULES_MODES.some((mode) => mode === value);
}

function refuseUnknownOption(key: string): Refusal {
  return {
    code: "options.unknown",
    message: `The option '${key}' is not one this target knows; it takes '${RULES_KEY}'.`,
    fix: `Remove '${key}' from the target's \`options\`.`,
    member: below({ member: "" }, key).member,
  };
}
