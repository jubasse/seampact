import type { ContractIR } from "@seampact/spec/ir";
import { isRecord, memberNames } from "./json.js";

// Whether two schemas or type uses accept and write the same JSON: equal once names, ids, annotations and
// derived members are left out, following schema and enum references into each IR. A use that moves to a
// renamed schema or enum of the same wire is a `name` change, not a `type.changed` one.

const WIRE_NEUTRAL_MEMBERS: ReadonlySet<string> = new Set([
  "codeName",
  "codeNames",
  "deprecated",
  "derivedFrom",
  "directions",
  "docs",
  "examples",
  "extensions",
  "id",
  "origin",
  "reason",
  "scalar",
  "sensitive",
  "typeName",
]);

interface WireComparison {
  readonly before: ContractIR;
  readonly after: ContractIR;
  /** Schema pairs assumed equal while they are compared, which ends a recursive schema. */
  readonly assumed: Set<string>;
}

export function isSameWireSchema(
  before: ContractIR,
  beforeId: string,
  after: ContractIR,
  afterId: string,
): boolean {
  return sameSchemaIds({ before, after, assumed: new Set() }, beforeId, afterId);
}

export function isSameWireEnum(
  before: ContractIR,
  beforeId: string,
  after: ContractIR,
  afterId: string,
): boolean {
  return sameEnumIds({ before, after, assumed: new Set() }, beforeId, afterId);
}

function sameSchemaIds(comparison: WireComparison, beforeId: string, afterId: string): boolean {
  const pair = `${beforeId}\u0000${afterId}`;

  if (comparison.assumed.has(pair)) return true;

  comparison.assumed.add(pair);

  const beforeSchema = comparison.before.schemas[beforeId];
  const afterSchema = comparison.after.schemas[afterId];

  return (
    beforeSchema !== undefined &&
    afterSchema !== undefined &&
    sameWire(comparison, beforeSchema, afterSchema)
  );
}

function sameEnumIds(comparison: WireComparison, beforeId: string, afterId: string): boolean {
  const beforeEnum = comparison.before.enums[beforeId];
  const afterEnum = comparison.after.enums[afterId];

  return (
    beforeEnum !== undefined &&
    afterEnum !== undefined &&
    sameWire(comparison, beforeEnum, afterEnum)
  );
}

function sameWire(comparison: WireComparison, before: unknown, after: unknown): boolean {
  if (Array.isArray(before) || Array.isArray(after)) return sameArrays(comparison, before, after);

  if (!isRecord(before) || !isRecord(after)) return before === after;

  return memberNames(before, after).every((member) => {
    if (WIRE_NEUTRAL_MEMBERS.has(member)) return true;

    const beforeValue = before[member];
    const afterValue = after[member];

    // A canonical name object; a string `name` is a wire name (a property's, a param's).
    if (member === "name" && (isRecord(beforeValue) || isRecord(afterValue))) return true;

    if (member === "schema" && typeof beforeValue === "string" && typeof afterValue === "string") {
      return sameSchemaIds(comparison, beforeValue, afterValue);
    }

    if (member === "enum" && typeof beforeValue === "string" && typeof afterValue === "string") {
      return sameEnumIds(comparison, beforeValue, afterValue);
    }

    return sameWire(comparison, beforeValue, afterValue);
  });
}

function sameArrays(comparison: WireComparison, before: unknown, after: unknown): boolean {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length)
    return false;

  return before.every((item, index) => sameWire(comparison, item, after[index]));
}
