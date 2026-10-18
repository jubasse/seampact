import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy, pipelinePointerBelow, type TreeNode } from "../../../pipeline/seam.js";
import {
  type DeriveErrorsRawObject,
  deriveErrorsEntries,
  deriveErrorsOriginOf,
  deriveErrorsMember,
  deriveErrorsString,
} from "./read.js";
import type { DeriveErrorsContext } from "./registry.js";
import type { DeriveErrorsRoute } from "./triggers.js";

// Attached codes (ADR 0002 section 11, ADR 0006 section 6 "Error declarations on the tree", A35): the codes of
// `conventions.errors.every`, and those of every node's `errors` whose attachment reaches the operation. `reach:
// subtree` (the default, or `conventions.errors.reach`) reaches every operation below the node; `resource` stops at
// a nested collection or single. `for: reads` reaches the safe operations, `writes` the others. An attached code keeps
// the origin of the nearest node attaching it, and the nearest narrowed example wins.

/** A code attached to an operation, with the derivation that attached it. */
export interface DeriveErrorsAttachedCode {
  readonly derivation: "node.errors" | "conventions.every";
  readonly code: IrWriter.ErrorCode;
  readonly from: readonly IrWriter.Origin[];
  /** The nearest node attaching the code; absent for `conventions.errors.every`. */
  readonly origin?: IrWriter.Origin;
  readonly example?: unknown;
}

const RESOURCE_REACH = "resource";
const READS = "reads";
const WRITES = "writes";
const EVERY_POINTER = "/conventions/errors/every";
const RESOURCE_BOUNDARIES: readonly string[] = ["collection", "single"];

// The ancestors of a node, nearest first, the node itself included.
function lineage(node: TreeNode): TreeNode[] {
  const nodes: TreeNode[] = [];

  for (let current: TreeNode | undefined = node; current !== undefined; current = current.parent)
    nodes.push(current);

  return nodes;
}

function forReaches(attachment: DeriveErrorsRawObject, safe: boolean): boolean {
  const narrowed = deriveErrorsString(attachment, "for");

  if (narrowed === READS) return safe;

  if (narrowed === WRITES) return !safe;

  return true;
}

/** The attached codes of one operation, nearest attachment first, each code once. */
export function deriveErrorsAttached(
  context: DeriveErrorsContext,
  route: DeriveErrorsRoute,
): DeriveErrorsAttachedCode[] {
  const defaultReach = context.conventions.get("errors.reach")?.value;
  const safe = route.operation.safe === true;
  const attached = new Map<IrWriter.ErrorCode, DeriveErrorsAttachedCode>();
  let crossedResource = false;

  for (const node of lineage(route.node)) {
    for (const [code, attachment] of deriveErrorsEntries(
      deriveErrorsMember(node.settings, "errors"),
    )) {
      const reach = deriveErrorsString(attachment, "reach") ?? defaultReach;

      if ((reach === RESOURCE_REACH && crossedResource) || !forReaches(attachment, safe)) continue;

      const example = deriveErrorsMember(attachment, "example");
      const nearer = attached.get(code);

      if (nearer === undefined) {
        attached.set(code, {
          derivation: "node.errors",
          code,
          from: [node.origin],
          origin: node.origin,
          ...(example === undefined ? {} : { example: pipelineCopy(example) }),
        });
        continue;
      }

      if (nearer.example === undefined && example !== undefined)
        attached.set(code, { ...nearer, example: pipelineCopy(example) });
    }

    // A nested collection or single bounds a `resource` attachment of the nodes above it.
    if (RESOURCE_BOUNDARIES.includes(node.kind)) crossedResource = true;
  }

  const every = context.conventions.get("errors.every");

  if (Array.isArray(every?.value) && every.origin !== undefined)
    every.value.forEach((code, index) => {
      if (typeof code !== "string" || attached.has(code)) return;

      const origin = deriveErrorsOriginOf(context, pipelinePointerBelow(EVERY_POINTER, index));

      attached.set(code, { derivation: "conventions.every", code, from: [origin] });
    });

  return [...attached.values()];
}
