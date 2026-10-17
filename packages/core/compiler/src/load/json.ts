import type { JsonObject, JsonValue } from "../raw-tree.js";

// The trees the loader builds hold keys an author wrote, so they are built defensively: objects
// without a prototype, own-property reads, keys defined rather than assigned, and the three
// names that reach a JavaScript object's prototype refused before they become keys.

/** Keys refused wherever an author writes one (`seampact/load/reserved-key`). */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export function isReservedKey(key: string): boolean {
  return RESERVED_KEYS.has(key);
}

/** An empty mapping with no prototype. */
export function jsonObject(): JsonObject {
  return Object.create(null) as JsonObject;
}

export function setKey(obj: JsonObject, key: string, value: JsonValue): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

export function asObject(v: JsonValue | undefined): JsonObject | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v : undefined;
}

/** The value of an own key, never one inherited. */
export function ownValue(obj: JsonObject, key: string): JsonValue | undefined {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/**
 * A deep copy, so a merged tree never shares a node with a layer tree (a layer is cached and
 * shared by every api that builds on it). Depth is bounded by the expansion limit.
 */
export function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  const obj = asObject(value);
  if (!obj) return value;
  const out = jsonObject();
  for (const [k, v] of Object.entries(obj)) setKey(out, k, cloneJson(v));
  return out;
}

/** For messages: a value as its author would recognise it, whatever its type. */
export function showValue(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "nothing");
}
