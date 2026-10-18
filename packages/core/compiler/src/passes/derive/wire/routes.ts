import {
  type DraftIR,
  type DraftOperation,
  type PassContextOf,
  pipelineTreeNodes,
  type TreeNode,
} from "../../../pipeline/seam.js";
import type { DeriveWireReporter } from "./report.js";

// Each operation of the draft with the tree node tree.nodes wrote it from, matched by the origin pointer, which
// tree.nodes sets to the node's own pointer (route, relay route or `ops` entry).

type DeriveWireContext = PassContextOf<"derive.wire">;

/** An operation with its node and what every writer of the half reads. */
export interface DeriveWireRoute {
  readonly id: string;
  readonly node: TreeNode;
  readonly operation: DraftOperation;
}

/** What the writers of the half share. */
export interface DeriveWireScope {
  readonly draft: DraftIR;
  readonly context: DeriveWireContext;
  readonly reporter: DeriveWireReporter;
  /** The collisions reported once for every route they reach, by derivation, place, name and location. */
  readonly reportedCollisions: Set<string>;
}

/** Every operation of the draft with its tree node, in draft order. */
export function deriveWireRoutes(draft: DraftIR, context: DeriveWireContext): DeriveWireRoute[] {
  const nodes = new Map(pipelineTreeNodes(context.raw).map((node) => [node.pointer, node]));

  return draft.operations.map((operation) => {
    const id = operation.id;
    const pointer = operation.origin?.pointer;
    const node = pointer === undefined ? undefined : nodes.get(pointer);

    if (id === undefined || node === undefined)
      throw new Error(
        `tree.nodes wrote an operation (${id ?? "no id"}) whose origin ${pointer ?? "(none)"} is no tree node`,
      );

    return { id, node, operation };
  });
}
