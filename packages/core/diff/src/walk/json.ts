import type { DiffValue } from "../result.js";

// JSON comparison and JSON Pointer helpers of the walk.

/** True when the two JSON values are equal, object member order aside. */
export function isSameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** JSON text with object members sorted and undefined members left out. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "null";

  const members = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);

  return `{${members.join(",")}}`;
}

/** Code unit order, the same in every locale. */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** `base` extended by the escaped segments (RFC 6901). */
export function pointerJoin(base: string, ...segments: readonly (string | number)[]): string {
  return segments.reduce<string>(
    (pointer, segment) =>
      `${pointer}/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`,
    base,
  );
}

/** The value as a report value when it is a scalar, else undefined. */
export function scalarValue(value: unknown): DiffValue | undefined {
  if (value === null) return null;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;

  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The union of the two objects' member names, sorted. */
export function memberNames(before: object | undefined, after: object | undefined): string[] {
  const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  return [...names].sort(compareText);
}
