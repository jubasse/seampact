import type { IrWriter, Origin } from "@seampact/spec/ir";
import {
  type ConventionPath,
  type ConventionReading,
  type DraftIR,
  type PassContextOf,
  type PassReadonly,
  pipelineIsJsonObject,
  pipelinePointerBelow,
  type TreeNode,
} from "../../../pipeline/seam.js";
import type { JsonValue } from "../../../raw-tree.js";

// Reading the merged raw tree, the conventions and the draft's schemas: the small helpers every part of tree.nodes
// shares.

/** The context tree.nodes runs in. */
export type TreeNodesContext = PassContextOf<"tree.nodes">;

/** A value of the merged raw tree. */
export type TreeNodesJson = PassReadonly<JsonValue>;

type Json = TreeNodesJson;

/** The maturity levels, least first (ADR 0002 section 5). */
export const TREE_NODES_MATURITIES: readonly IrWriter.Maturity[] = [
  "experimental",
  "provisional",
  "stable",
];

/** A convention as written at its own leaf, with its origin; undefined for a core default or one read elsewhere. */
export function treeNodesWrittenConvention(
  context: TreeNodesContext,
  path: ConventionPath,
): (ConventionReading & { readonly origin: Origin }) | undefined {
  const reading = context.conventions.get(path);
  const pointer = treeNodesPointer("/conventions", ...path.split("."));
  if (reading?.origin === undefined || reading.origin.pointer !== pointer) return undefined;
  return { value: reading.value, origin: reading.origin };
}

/** Whether a raw value is a mapping (the seam's shared check). */
export const treeNodesIsObject = pipelineIsJsonObject;

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

/** The JSON Pointer of `segments` below `base`, each segment escaped (the seam's shared helper). */
export const treeNodesPointer = pipelinePointerBelow;

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
