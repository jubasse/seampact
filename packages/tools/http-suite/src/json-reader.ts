// Reads a parsed JSON document member by member, each fault named by its JSON pointer: the shared reader of the
// case format and the sample app script.
import type { JsonValue } from "./suite-case.js";

/** Where a reader reports a fault: `fail` throws the caller's error, naming the pointer. */
export interface JsonReader {
  fail(pointer: string, problem: string): never;
}

export function objectAt(
  reader: JsonReader,
  value: unknown,
  pointer: string,
  allowedMembers: readonly string[] | undefined,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return reader.fail(pointer, "expected a JSON object");
  }

  const object: Record<string, unknown> = { ...value };

  for (const member of Object.keys(object)) {
    if (allowedMembers !== undefined && !allowedMembers.includes(member)) {
      reader.fail(
        `${pointer}/${member}`,
        `unknown member; use one of ${allowedMembers.join(", ")}`,
      );
    }
  }

  return object;
}

export function arrayAt(reader: JsonReader, value: unknown, pointer: string): unknown[] {
  if (!Array.isArray(value)) return reader.fail(pointer, "expected a JSON array");

  return [...value];
}

export function stringAt(reader: JsonReader, value: unknown, pointer: string): string {
  if (typeof value !== "string") return reader.fail(pointer, "expected a string");

  return value;
}

export function patternAt(
  reader: JsonReader,
  value: unknown,
  pointer: string,
  pattern: RegExp,
): string {
  const text = stringAt(reader, value, pointer);

  if (!pattern.test(text)) reader.fail(pointer, `'${text}' does not match ${pattern.source}`);

  return text;
}

export function stringMapAt(
  reader: JsonReader,
  value: unknown,
  pointer: string,
): Record<string, string> {
  const object = objectAt(reader, value, pointer, undefined);

  return Object.fromEntries(
    Object.entries(object).map(([member, text]) => [
      member,
      stringAt(reader, text, `${pointer}/${member}`),
    ]),
  );
}

export function jsonObjectAt(
  reader: JsonReader,
  value: unknown,
  pointer: string,
): { [member: string]: JsonValue } {
  const object = objectAt(reader, value, pointer, undefined);

  return Object.fromEntries(
    Object.entries(object).map(([member, item]) => [
      member,
      jsonAt(reader, item, `${pointer}/${member}`),
    ]),
  );
}

// A copy of a parsed JSON value, so a case never shares its members with the caller's object.
export function jsonAt(reader: JsonReader, value: unknown, pointer: string): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : reader.fail(pointer, "expected a finite number");
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => jsonAt(reader, item, `${pointer}/${index}`));
  }

  return jsonObjectAt(reader, value, pointer);
}

const MIN_STATUS = 100;
const MAX_STATUS = 599;

/** An HTTP status: an integer from 100 to 599. */
export function statusAt(reader: JsonReader, value: unknown, pointer: string): number {
  if (!Number.isInteger(value) || Number(value) < MIN_STATUS || Number(value) > MAX_STATUS) {
    reader.fail(pointer, `the status is an integer from ${MIN_STATUS} to ${MAX_STATUS}`);
  }

  return Number(value);
}
