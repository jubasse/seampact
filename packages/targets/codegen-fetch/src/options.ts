import type { ParseOptionsOutcome, Refusal } from "@seampact/codegen-core";

// How a generated method hands back a declared error or an unexpected answer: as a result the caller checks, or
// as a thrown `ContractError` carrying it. A network failure or a timeout rejects in both.
export const ERROR_STYLES = ["result", "throw"] as const;

export type ErrorStyle = (typeof ERROR_STYLES)[number];

export interface FetchClientOptions {
  errorStyle: ErrorStyle;
}

const ERROR_STYLE_KEY = "errorStyle";

export const DEFAULT_OPTIONS: FetchClientOptions = { errorStyle: "result" };

// Accepts `{}` or `{ errorStyle: result | throw }`; any other key or value is refused by name.
export function parseFetchClientOptions(raw: unknown): ParseOptionsOutcome<FetchClientOptions> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return refused({
      code: "options.invalid",
      message: "The target options are not an object.",
      fix: "Write the target's `options` as an object, or leave it out.",
      member: "",
    });
  }

  const refusals = Object.keys(raw)
    .filter((key) => key !== ERROR_STYLE_KEY)
    .map(refuseUnknownOption);
  const errorStyle = Object.hasOwn(raw, ERROR_STYLE_KEY)
    ? Object.getOwnPropertyDescriptor(raw, ERROR_STYLE_KEY)?.value
    : DEFAULT_OPTIONS.errorStyle;

  if (!isErrorStyle(errorStyle)) {
    refusals.push({
      code: "options.errorStyle.invalid",
      message: `The option 'errorStyle' is ${JSON.stringify(errorStyle)}, not one of ${ERROR_STYLES.join(", ")}.`,
      fix: "Set 'errorStyle' to 'result' (the default) or 'throw'.",
      member: `/${ERROR_STYLE_KEY}`,
    });
  }

  if (refusals.length > 0 || !isErrorStyle(errorStyle)) return { status: "refused", refusals };

  return { status: "parsed", options: { errorStyle } };
}

function isErrorStyle(value: unknown): value is ErrorStyle {
  return ERROR_STYLES.some((style) => style === value);
}

function refuseUnknownOption(key: string): Refusal {
  return {
    code: "options.unknown",
    message: `The option '${key}' is not one this target knows; it takes 'errorStyle' only.`,
    fix: `Remove '${key}' from the target's \`options\`.`,
    member: `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
  };
}

function refused(refusal: Refusal): ParseOptionsOutcome<FetchClientOptions> {
  return { status: "refused", refusals: [refusal] };
}
