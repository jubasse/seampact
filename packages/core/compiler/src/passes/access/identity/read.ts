import type { PassReadonly } from "../../../pipeline/seam.js";
import type { JsonObject, JsonValue } from "../../../raw-tree.js";

// Readers of the merged raw tree for the access.identity half. The authoring schema has already checked every
// shape (the validate stage stops the pipeline otherwise), so a reader only narrows the JSON types; a member the
// grammar leaves optional reads as undefined when absent.

export type AccessIdentityRawValue = PassReadonly<JsonValue>;

export type AccessIdentityRawObject = PassReadonly<JsonObject>;

export const accessIdentityIsObject = (
  value: AccessIdentityRawValue | undefined,
): value is AccessIdentityRawObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An own member of a raw mapping; undefined when absent. */
export const accessIdentityMember = (
  object: AccessIdentityRawObject,
  key: string,
): AccessIdentityRawValue | undefined => (Object.hasOwn(object, key) ? object[key] : undefined);

/** A string member; undefined when absent or of another type. */
export function accessIdentityString(
  object: AccessIdentityRawObject,
  key: string,
): string | undefined {
  const value = accessIdentityMember(object, key);
  return typeof value === "string" ? value : undefined;
}

/** A boolean member; undefined when absent or of another type. */
export function accessIdentityBoolean(
  object: AccessIdentityRawObject,
  key: string,
): boolean | undefined {
  const value = accessIdentityMember(object, key);
  return typeof value === "boolean" ? value : undefined;
}

/** A list of strings, copied; undefined when absent. */
export function accessIdentityStrings(
  object: AccessIdentityRawObject,
  key: string,
): string[] | undefined {
  const value = accessIdentityMember(object, key);
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

/** A mapping member; undefined when absent or of another type. */
export function accessIdentityObject(
  object: AccessIdentityRawObject,
  key: string,
): AccessIdentityRawObject | undefined {
  const value = accessIdentityMember(object, key);
  return accessIdentityIsObject(value) ? value : undefined;
}

/** The entries of a mapping member whose values are mappings, in written order. */
export function accessIdentityEntries(
  object: AccessIdentityRawObject,
  key: string,
): [string, AccessIdentityRawObject][] {
  const catalogue = accessIdentityObject(object, key);
  if (catalogue === undefined) return [];

  const entries: [string, AccessIdentityRawObject][] = [];
  for (const [name, value] of Object.entries(catalogue))
    if (accessIdentityIsObject(value)) entries.push([name, value]);
  return entries;
}

/** The JSON Pointer below `base` through `segments` (RFC 6901). */
export const accessIdentityPointer = (base: string, ...segments: readonly string[]): string =>
  base +
  segments.map((segment) => `/${segment.replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
