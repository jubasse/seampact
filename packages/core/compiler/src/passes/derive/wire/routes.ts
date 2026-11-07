import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftIR,
  type DraftOperation,
  type PassContextOf,
  pipelineTreeNodes,
  type TreeNode,
} from "../../../pipeline/seam.js";
import type { DeriveWireProblem, DeriveWireRelated, DeriveWireReporter } from "./report.js";

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
  /** The faults of an inherited setting, one per rule and authored origin, reported after the last route. */
  readonly settingFaults: Map<string, DeriveWireSettingFault>;
}

/** A fault of an inherited setting, with every route it reaches. */
export interface DeriveWireSettingFault {
  readonly problem: DeriveWireProblem;
  readonly routes: DeriveWireRelated[];
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

/** The access access.identity wrote on the operation, a relay route's included; none is an internal error. */
export function deriveWireAccessOf(route: DeriveWireRoute): IrWriter.Access {
  const access = route.operation.access;

  if (access === undefined)
    throw new Error(`access.identity wrote no access on operation '${route.id}'`);

  return access;
}

/** The origin of a pointer of the merged raw tree the half read; one without an origin is an internal error. */
export function deriveWireOriginAt(scope: DeriveWireScope, pointer: string): IrWriter.Origin {
  const origin = scope.context.origin(pointer);

  if (origin === undefined) throw new Error(`${pointer} has no origin in the side table`);

  return origin;
}
