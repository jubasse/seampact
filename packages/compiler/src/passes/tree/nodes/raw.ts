import type { IrWriter } from "@seampact/spec/ir";
import type { DraftIR, PassReadonly, TreeNode } from "../../../pipeline/seam.js";
import type { JsonObject, JsonValue } from "../../../raw-tree.js";

// Reading the merged raw tree and the draft's schemas: the small helpers every part of tree.nodes shares.

type Json = PassReadonly<JsonValue>;

export const treeNodesIsObject = (value: Json | undefined): value is PassReadonly<JsonObject> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A member of a raw mapping, undefined when the value is no mapping or lacks it. */
export function treeNodesMember(value: Json | undefined, key: string): Json | undefined {
  return treeNodesIsObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

/** A setting written on a tree node. */
export const treeNodesSetting = (node: TreeNode, key: string): Json | undefined =>
  treeNodesMember(node.settings, key);

/** A setting written on a tree node as text, else undefined. */
export function treeNodesText(node: TreeNode, key: string): string | undefined {
  const value = treeNodesSetting(node, key);
  return typeof value === "string" ? value : undefined;
}

// RFC 6901: `~` and `/` inside a segment.
export const treeNodesEscape = (segment: string): string =>
  segment.replaceAll("~", "~0").replaceAll("/", "~1");

/** The JSON Pointer of `segments` below `base`, each segment escaped. */
export const treeNodesPointer = (base: string, ...segments: readonly string[]): string =>
  [base, ...segments.map(treeNodesEscape)].join("/");

/** A schema of the draft's catalogue, read by its id. */
export function treeNodesSchema(draft: DraftIR, id: string): IrWriter.Schema | undefined {
  return Object.hasOwn(draft.schemas, id) ? draft.schemas[id] : undefined;
}

/** The object schema a use refers to, else undefined. */
export function treeNodesObjectOf(
  draft: DraftIR,
  use: IrWriter.TypeUse | undefined,
): IrWriter.ObjectSchema | undefined {
  const schema = use?.kind === "ref" ? treeNodesSchema(draft, use.schema) : undefined;
  return schema?.kind === "object" ? schema : undefined;
}

/** The header a union reads its tag from, when the use refers to a header-tagged union. */
export function treeNodesTagHeader(
  draft: DraftIR,
  use: IrWriter.TypeUse | undefined,
): string | undefined {
  const schema = use?.kind === "ref" ? treeNodesSchema(draft, use.schema) : undefined;
  return schema?.kind === "union" && schema.tag.in === "header" ? schema.tag.name : undefined;
}
