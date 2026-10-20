// The JSON values a document holds, and the copy that turns an IR value into one.

export type JsonValue = null | boolean | number | bigint | string | JsonValue[] | JsonObject;

export interface JsonObject {
  [member: string]: JsonValue;
}

/** A deep copy of a value read from the IR, so a document never shares an object with it. */
export function copyJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;

  if (typeof value === "number" || typeof value === "bigint") return value;

  if (Array.isArray(value)) return value.map(copyJsonValue);

  if (typeof value === "object") {
    const copy: JsonObject = {};

    for (const [member, memberValue] of Object.entries(value)) {
      copy[member] = copyJsonValue(memberValue);
    }

    return copy;
  }

  throw new TypeError(`An IR value of type ${typeof value} is not JSON; regenerate the IR.`);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A copy of an optional IR value. */
export function copyOptional(value: unknown): JsonValue | undefined {
  return value === undefined ? undefined : copyJsonValue(value);
}

/** Sets `member` only when `value` is defined, so an absent IR member writes no key. */
export function setDefined(target: JsonObject, member: string, value: JsonValue | undefined): void {
  if (value !== undefined) target[member] = value;
}
