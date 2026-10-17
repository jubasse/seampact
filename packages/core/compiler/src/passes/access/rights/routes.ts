import {
  type DraftIR,
  type DraftOperation,
  type PassReadonly,
  pipelineTreeNodes,
  type TreeNode,
} from "../../../pipeline/seam.js";
import { accessRightsMember, accessRightsPointer, accessRightsString } from "./read.js";
import type { AccessRightsContext } from "./schema-use.js";

// The route of each draft operation: its tree node (ADR 0002 section 6) and the access facts this half reads from
// the merged raw tree, so it never waits for access.identity's per-operation members.

/** How a route is reached (ADR 0002 section 9): an identity is required, optional, or none (public). */
export type AccessRightsAccessKind = "identity" | "optional" | "public";

export interface AccessRightsRoute {
  readonly operation: PassReadonly<DraftOperation>;
  readonly id: string;
  readonly node: TreeNode;
  readonly access: AccessRightsAccessKind;
  /** The `access` setting that makes the route public or optional-auth. */
  readonly accessPointer?: string;
  /** The identity the route runs under, unless it is public. */
  readonly identity?: string;
}

/** The api facts the access checks read: its kind and, on a service api, its caller (ADR 0002 section 5). */
export interface AccessRightsApi {
  readonly kind: string;
  readonly caller?: { readonly identity: string; readonly right: string };
}

const API_KIND_DEFAULT = "product";

/** The api's kind and caller, from the merged raw tree. */
export function accessRightsApi(context: AccessRightsContext): AccessRightsApi {
  const api = accessRightsMember(context.raw.merged, "api");
  const caller = accessRightsMember(api, "caller");
  const identity = accessRightsString(caller, "identity");
  const right = accessRightsString(caller, "right");
  return {
    kind: accessRightsString(api, "kind") ?? API_KIND_DEFAULT,
    ...(identity === undefined || right === undefined ? {} : { caller: { identity, right } }),
  };
}

/** Every operation of the draft with its tree node, in draft order. */
export function accessRightsRoutes(
  draft: PassReadonly<DraftIR>,
  context: AccessRightsContext,
  api: AccessRightsApi,
): AccessRightsRoute[] {
  const nodes = new Map(pipelineTreeNodes(context.raw).map((node) => [node.pointer, node]));

  return draft.operations.map((operation) => {
    const id = operation.id;
    const pointer = operation.origin?.pointer;
    const node = pointer === undefined ? undefined : nodes.get(pointer);
    if (id === undefined || node === undefined)
      throw new Error(
        `tree.nodes wrote an operation (${id ?? "no id"}) whose origin ${pointer ?? "(none)"} is no tree node`,
      );

    return { operation, id, node, ...accessOf(context, node, api) };
  });
}

const depthOf = (node: TreeNode): number => {
  let depth = 0;
  for (let at = node.parent; at !== undefined; at = at.parent) depth += 1;
  return depth;
};

// `identity` and `access` are inherited separately; a node that sets `identity` without `access` makes the
// identity required again below it, and a node setting both keeps its access (ADR 0002 section 9).
function accessOf(
  context: AccessRightsContext,
  node: TreeNode,
  api: AccessRightsApi,
): Pick<AccessRightsRoute, "access" | "accessPointer" | "identity"> {
  const access = context.inherited(node, "access")?.entry;
  const identityEntry = context.inherited(node, "identity")?.entry;
  // A service api's routes all run under its caller identity, which no node may change (ADR 0002 section 5).
  const identity =
    api.caller?.identity ??
    (typeof identityEntry?.value === "string" ? identityEntry.value : undefined);

  const accessApplies =
    access !== undefined &&
    (identityEntry === undefined || depthOf(access.node) >= depthOf(identityEntry.node));
  if (!accessApplies)
    return identity === undefined ? { access: "identity" } : { access: "identity", identity };

  const accessPointer = accessRightsPointer(access.node.pointer, "access");
  if (accessRightsMember(access.value, "public") !== undefined)
    return { access: "public", accessPointer };
  if (accessRightsMember(access.value, "optionalAuth") !== undefined)
    return identity === undefined
      ? { access: "optional", accessPointer }
      : { access: "optional", accessPointer, identity };
  return identity === undefined ? { access: "identity" } : { access: "identity", identity };
}

/** The nearest `scope` node at or above `node`, and the collection it belongs to. */
export function accessRightsScopeOf(
  node: TreeNode,
): { readonly scope: TreeNode; readonly collection: TreeNode } | undefined {
  for (let at: TreeNode | undefined = node; at !== undefined; at = at.parent)
    if (at.kind === "scope" && at.parent !== undefined) return { scope: at, collection: at.parent };
  return undefined;
}

/** The collection or single a route belongs to: its nearest such ancestor (ADR 0002 section 2, `{resource}`). */
export function accessRightsResourceOf(node: TreeNode): TreeNode | undefined {
  for (let at = node.parent; at !== undefined; at = at.parent)
    if (at.kind === "collection" || at.kind === "single") return at;
  return undefined;
}
