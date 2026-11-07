import type { IrWriter } from "@seampact/spec/ir";
import {
  type PassContext,
  type PassReadonly,
  pipelineCopy,
  pipelineIsJsonObject,
} from "../../../pipeline/seam.js";
import type { JsonObject, JsonValue } from "../../../raw-tree.js";

// Readers of the merged raw tree for the derive.errors half. The authoring schema has already checked every shape
// (the validate stage stops the pipeline otherwise), so a reader only narrows the JSON types.

export type DeriveErrorsRawValue = PassReadonly<JsonValue>;

export type DeriveErrorsRawObject = PassReadonly<JsonObject>;

/** An own member of a raw mapping; undefined when absent or when `object` is no mapping. */
export const deriveErrorsMember = (
  object: DeriveErrorsRawValue | undefined,
  key: string,
): DeriveErrorsRawValue | undefined =>
  pipelineIsJsonObject(object) && Object.hasOwn(object, key) ? object[key] : undefined;

/** A string member; undefined when absent or of another type. */
export function deriveErrorsString(
  object: DeriveErrorsRawValue | undefined,
  key: string,
): string | undefined {
  const value = deriveErrorsMember(object, key);

  return typeof value === "string" ? value : undefined;
}

/** The entries of a mapping whose values are mappings, in written order. */
export function deriveErrorsEntries(
  catalogue: DeriveErrorsRawValue | undefined,
): [string, DeriveErrorsRawObject][] {
  if (!pipelineIsJsonObject(catalogue)) return [];

  const entries: [string, DeriveErrorsRawObject][] = [];

  for (const [name, value] of Object.entries(catalogue))
    if (pipelineIsJsonObject(value)) entries.push([name, value]);

  return entries;
}

/** The `docs` of a declaration: its written `summary` and `description`. */
export function deriveErrorsDocs(declaration: DeriveErrorsRawObject): IrWriter.Docs {
  const summary = deriveErrorsString(declaration, "summary");
  const description = deriveErrorsString(declaration, "description");

  return {
    ...(summary === undefined ? {} : { summary }),
    ...(description === undefined ? {} : { description }),
  };
}

/** The origin of a node of the merged raw tree the half read, copied for the draft. */
export function deriveErrorsOriginOf(context: PassContext, pointer: string): IrWriter.Origin {
  const origin = context.origin(pointer);

  if (origin === undefined)
    throw new Error(`derive.errors read ${pointer}, which has no origin in the merged raw tree`);

  return pipelineCopy(origin);
}
