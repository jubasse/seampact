import type { Refusal } from "./refusal.js";
import type { ParseOptionsOutcome } from "./target.js";

// The options of a target that takes none yet: naming and style options wait (A47).
export type NoOptions = Record<string, never>;

// Accepts `{}` only; each key is refused by name.
export function parseNoOptions(raw: unknown): ParseOptionsOutcome<NoOptions> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      status: "refused",
      refusals: [
        {
          code: "options.invalid",
          message: `The target options are ${describeValue(raw)}, not an object.`,
          fix: "Write the target's `options` as an object, or leave it out.",
          member: "",
        },
      ],
    };
  }

  const unknownKeys = Object.keys(raw);

  if (unknownKeys.length === 0) return { status: "parsed", options: {} };

  return { status: "refused", refusals: unknownKeys.map(refuseUnknownOption) };
}

function refuseUnknownOption(key: string): Refusal {
  return {
    code: "options.unknown",
    message: `The option '${key}' is not one this target knows; it takes no option yet.`,
    fix: `Remove '${key}' from the target's \`options\`.`,
    member: `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
  };
}

function describeValue(raw: unknown): string {
  if (raw === null) return "null";

  if (Array.isArray(raw)) return "an array";

  return `a ${typeof raw}`;
}
