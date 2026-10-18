import { below } from "../ir-location.js";
import type { Refusal } from "../refusal.js";
import type { ParseOptionsOutcome } from "../target.js";

// The options every Node server target takes (ADR 0016 "Target options"): what a reply outside the contract does,
// and whether JSON success replies are validated by the zod output validators.
const RESPONSES_MODES = ["strict", "warn"] as const;

export type ResponsesMode = (typeof RESPONSES_MODES)[number];

export interface NodeServerOptions {
  responses: ResponsesMode;
  bodyValidation: boolean;
}

const RESPONSES_KEY = "responses";
const BODY_VALIDATION_KEY = "bodyValidation";
const KNOWN_KEYS: readonly string[] = [RESPONSES_KEY, BODY_VALIDATION_KEY];

const DEFAULT_NODE_SERVER_OPTIONS: NodeServerOptions = {
  responses: "strict",
  bodyValidation: false,
};

// Accepts `{}`, `responses: strict | warn` and `bodyValidation: true | false`; any other key or value is refused.
export function parseNodeServerOptions(raw: unknown): ParseOptionsOutcome<NodeServerOptions> {
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
    .filter((key) => !KNOWN_KEYS.includes(key))
    .map(refuseUnknownOption);
  const responses = optionValue(raw, RESPONSES_KEY, DEFAULT_NODE_SERVER_OPTIONS.responses);
  const bodyValidation = optionValue(
    raw,
    BODY_VALIDATION_KEY,
    DEFAULT_NODE_SERVER_OPTIONS.bodyValidation,
  );

  if (!isResponsesMode(responses)) {
    refusals.push({
      code: "options.responses.invalid",
      message: `The option 'responses' is ${JSON.stringify(responses)}, not one of ${RESPONSES_MODES.join(", ")}.`,
      fix: "Set 'responses' to 'strict' (the default) or 'warn'.",
      member: `/${RESPONSES_KEY}`,
    });
  }

  if (typeof bodyValidation !== "boolean") {
    refusals.push({
      code: "options.bodyValidation.invalid",
      message: `The option 'bodyValidation' is ${JSON.stringify(bodyValidation)}, not true or false.`,
      fix: "Set 'bodyValidation' to true or false (the default).",
      member: `/${BODY_VALIDATION_KEY}`,
    });
  }

  if (refusals.length > 0 || !isResponsesMode(responses) || typeof bodyValidation !== "boolean") {
    return { status: "refused", refusals };
  }

  return { status: "parsed", options: { responses, bodyValidation } };
}

function optionValue(raw: object, key: string, fallback: unknown): unknown {
  return Object.hasOwn(raw, key) ? Object.getOwnPropertyDescriptor(raw, key)?.value : fallback;
}

function isResponsesMode(value: unknown): value is ResponsesMode {
  return RESPONSES_MODES.some((mode) => mode === value);
}

function refuseUnknownOption(key: string): Refusal {
  return {
    code: "options.unknown",
    message: `The option '${key}' is not one this target knows; it takes 'responses' and 'bodyValidation'.`,
    fix: `Remove '${key}' from the target's \`options\`.`,
    member: below({ member: "" }, key).member,
  };
}
