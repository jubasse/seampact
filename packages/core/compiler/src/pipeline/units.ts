import { authoringSchemas } from "@seampact/spec/authoring";

// The unit readers tree and derive both need (ADR 0002 section 4): a size (`1MiB`) in bytes and a duration
// (`150ms`, `24h`) in milliseconds. A value is read only when it matches the grammar's own pattern
// (`@seampact/spec/authoring`, `common` definitions `size` and `duration`), so the reader never accepts more than
// the authoring schema does.

/** The units of each grammar definition, in its base unit; a test keeps them equal to the patterns' units. */
export const pipelineUnits = {
  size: { B: 1, KiB: 1024, MiB: 1024 * 1024 },
  duration: { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 },
} as const satisfies Record<string, Record<string, number>>;

type UnitKind = keyof typeof pipelineUnits;

const patterns = new Map<UnitKind, RegExp>();

/** The grammar's pattern of a unit definition (`size` or `duration`). */
export function pipelineUnitPattern(kind: UnitKind): string {
  const defs: unknown = authoringSchemas().common.$defs;
  const def: unknown =
    typeof defs === "object" && defs !== null ? Reflect.get(defs, kind) : undefined;
  const pattern: unknown =
    typeof def === "object" && def !== null ? Reflect.get(def, "pattern") : undefined;

  if (typeof pattern !== "string") throw new Error(`the authoring grammar has no ${kind} pattern`);

  return pattern;
}

function parse(kind: UnitKind, text: string): number | undefined {
  let pattern = patterns.get(kind);

  if (pattern === undefined) {
    pattern = new RegExp(pipelineUnitPattern(kind));
    patterns.set(kind, pattern);
  }

  const match = pattern.test(text) ? /^([0-9]+)(.+)$/.exec(text) : null;

  if (match === null) return undefined;
  const units: Readonly<Record<string, number>> = pipelineUnits[kind];
  const unit = match[2] ?? "";

  if (!Object.hasOwn(units, unit)) throw new Error(`the ${kind} unit ${unit} has no reading`);
  const value = Number(match[1]) * (units[unit] as number);

  return Number.isSafeInteger(value) ? value : undefined;
}

/** A size in bytes (`1MiB` is 1048576); undefined for a text outside the grammar or beyond a safe integer. */
export const pipelineParseSize = (text: string): number | undefined => parse("size", text);

/** A duration in milliseconds (`24h` is 86400000); undefined for a text outside the grammar or too large. */
export const pipelineParseDuration = (text: string): number | undefined => parse("duration", text);
