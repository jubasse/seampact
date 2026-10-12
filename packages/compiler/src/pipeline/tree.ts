import type { Origin } from "@seampact/spec/ir";
import type { JsonObject } from "../raw-tree.js";

// The tree-node model of the merged raw tree (ADR 0002 section 6), which `inherited` walks (ADR 0006 section 2).
// PR 2 of p2-pipeline adds `treeNodes(raw)`, which lists the nodes in document order.

/**
 * The kind of a tree node. `scope` is the `collection` or `member` scope of a collection, which exists whether or
 * not it is written; `op` is one entry of an `ops` shorthand, whose parent is its scope (`list`, `create`, `batch`
 * under `collection`, `get`, `update`, `delete` under `member`) or the single it is written on.
 */
export type TreeNodeKind = "surface" | "single" | "collection" | "scope" | "route" | "relay" | "op";

export interface TreeNode {
  kind: TreeNodeKind;
  /** The surface, child, scope (`collection` or `member`) or op name. */
  name: string;
  /** The JSON Pointer of the node in the merged raw tree; a scope or op not written points where it would be. */
  pointer: string;
  parent?: TreeNode;
  /** The settings written on the node (an empty object for a scope or op not written). */
  settings: Readonly<JsonObject>;
  /** The origin of the node: the layer that wrote it, or its parent's for a node not written. */
  origin: Origin;
}
