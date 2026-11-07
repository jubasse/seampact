import type { IrWriter } from "@seampact/spec/ir";
import { type PassReadonly, pipelineCopy, pipelineIsJsonObject } from "../../../pipeline/seam.js";
import type { JsonObject, JsonValue } from "../../../raw-tree.js";
import type { AccessRightsContext } from "./schema-use.js";

// Readers of the merged raw tree for the access.rights half. The authoring schema has already checked every shape
// (the validate stage stops the pipeline otherwise), so a reader only narrows the JSON types; a member the grammar
// leaves optional reads as undefined when absent.

export type AccessRightsRawValue = PassReadonly<JsonValue>;

export type AccessRightsRawObject = PassReadonly<JsonObject>;

/** An own member of a raw mapping; undefined when absent or when `object` is no mapping. */
export const accessRightsMember = (
  object: AccessRightsRawValue | undefined,
  key: string,
): AccessRightsRawValue | undefined =>
  pipelineIsJsonObject(object) && Object.hasOwn(object, key) ? object[key] : undefined;

/** A string member; undefined when absent or of another type. */
export function accessRightsString(
  object: AccessRightsRawValue | undefined,
  key: string,
): string | undefined {
  const value = accessRightsMember(object, key);

  return typeof value === "string" ? value : undefined;
}

/** The strings of a list member, in written order; an empty list when absent. */
export function accessRightsStrings(
  object: AccessRightsRawValue | undefined,
  key: string,
): string[] {
  const value = accessRightsMember(object, key);

  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === "string");
}

/** The entries of a mapping member whose values are mappings, in written order. */
export function accessRightsEntries(
  object: AccessRightsRawValue | undefined,
  key: string,
): [string, AccessRightsRawObject][] {
  const catalogue = accessRightsMember(object, key);

  if (!pipelineIsJsonObject(catalogue)) return [];

  const entries: [string, AccessRightsRawObject][] = [];

  for (const [name, value] of Object.entries(catalogue))
    if (pipelineIsJsonObject(value)) entries.push([name, value]);

  return entries;
}

/** The `docs` of a declaration: its written `summary` and `description`. */
export function accessRightsDocs(declaration: AccessRightsRawObject): {
  summary?: string;
  description?: string;
} {
  const summary = accessRightsString(declaration, "summary");
  const description = accessRightsString(declaration, "description");

  return {
    ...(summary === undefined ? {} : { summary }),
    ...(description === undefined ? {} : { description }),
  };
}

// `x-<prefix>-<key>` (ADR 0002 section 12): the prefix holds no dash, so the key is everything after it. The key
// may be `__proto__`, so the slot is built with `Object.fromEntries`, which defines own members only.
const EXTENSION_KEY = /^x-([a-z][a-z0-9]*)-(.+)$/;

/**
 * The extension values written on a declaration (`x-<prefix>-<key>`), copied into the IR slot
 * `{ <prefix>: { <key>: value } }`. tree.schemas has checked each against its declaration (ADR 0008).
 */
export function accessRightsExtensions(
  declaration: AccessRightsRawObject,
): Record<string, Record<string, unknown>> {
  const slot = new Map<string, [string, unknown][]>();

  for (const [key, value] of Object.entries(declaration)) {
    const match = EXTENSION_KEY.exec(key);

    if (match === null) continue;

    const [, prefix, name] = match;

    if (prefix === undefined || name === undefined)
      throw new Error(`the extension key '${key}' matched without its prefix and key`);
    const keys = slot.get(prefix) ?? [];

    keys.push([name, pipelineCopy(value)]);
    slot.set(prefix, keys);
  }

  return Object.fromEntries([...slot].map(([prefix, keys]) => [prefix, Object.fromEntries(keys)]));
}

/** The origin of a node of the merged raw tree the half read, copied for the draft. */
export function accessRightsOriginOf(
  context: AccessRightsContext,
  pointer: string,
): IrWriter.Origin {
  const origin = context.origin(pointer);

  if (origin === undefined)
    throw new Error(`access.rights read ${pointer}, which has no origin in the merged raw tree`);

  return pipelineCopy(origin);
}

/**
 * The schema name a written schema position holds (`TaskId`, or `{ $ref: TaskId }`), undefined for an inline
 * schema. Two id positions naming different schemas are different ids, even when both compile to one type use.
 */
export function accessRightsSchemaName(
  value: AccessRightsRawValue | undefined,
): string | undefined {
  if (typeof value === "string") return value;

  if (!pipelineIsJsonObject(value)) return undefined;

  const ref = accessRightsString(value, "$ref");

  return ref !== undefined && Object.keys(value).length === 1 ? ref : undefined;
}
