import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftIR,
  type DraftOperation,
  type PassContextOf,
  pipelineCopy,
  pipelineTreeNodes,
  type TreeNode,
} from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import { treeNodesInput } from "./input.js";
import {
  type TreeNodesOperationName,
  treeNodesIdParam,
  treeNodesIsOperation,
  treeNodesOperationName,
  treeNodesSingularOwner,
} from "./names.js";

// The operations of the api (ADR 0002 sections 6 and 7): one per route, relay route and `ops` entry, in tree order,
// each with its id, name, surface, op, resource, method, safety, declared input and origin. A relay route's method
// and shape are copied from the public operation it relays.

type TreeNodesContext = PassContextOf<"tree.nodes">;

const OPERATION_KIND = "httpOperation";

const HTTP_METHODS: readonly IrWriter.HttpMethod[] = ["get", "post", "put", "patch", "delete"];
const OP_SHORTHANDS: readonly IrWriter.OpShorthand[] = [
  "list",
  "get",
  "create",
  "update",
  "delete",
  "batch",
];

// ADR 0002 section 6: a batch is a safe read sent as POST.
const SAFE_OP: IrWriter.OpShorthand = "batch";
const SAFE_METHOD: IrWriter.HttpMethod = "get";

const isHttpMethod = (value: unknown): value is IrWriter.HttpMethod =>
  HTTP_METHODS.some((method) => method === value);

const isOpShorthand = (value: string): value is IrWriter.OpShorthand =>
  OP_SHORTHANDS.some((op) => op === value);

/** An operation written to the draft, with the node it came from and its name. */
interface Written {
  readonly node: TreeNode;
  readonly name: TreeNodesOperationName;
}

/** Writes every operation of the api to the draft, in tree order, and reports the id and name clashes. */
export function treeNodesOperations(draft: DraftIR, context: TreeNodesContext): void {
  const written: Written[] = [];
  const collectionsWithoutSingular = new Set<string>();
  for (const node of pipelineTreeNodes(context.raw)) {
    if (!treeNodesIsOperation(node)) continue;

    const name = treeNodesOperationName(node, context.conventions);
    if (name === undefined) {
      reportNoSingular(node, collectionsWithoutSingular, context);
      continue;
    }

    draft.operations.push(operationOf(node, name, draft, context));
    written.push({ node, name });
  }

  reportClashes(written, context);
}

function operationOf(
  node: TreeNode,
  name: TreeNodesOperationName,
  draft: DraftIR,
  context: TreeNodesContext,
): DraftOperation {
  const op = node.kind === "op" && isOpShorthand(node.name) ? node.name : undefined;
  const resource = resourceOf(node);
  const method = methodOf(node, op, context);
  const input = treeNodesInput(node, name.id, draft, context);

  return {
    kind: OPERATION_KIND,
    id: name.id,
    name: pipelineCopy(name.name),
    surface: surfaceOf(node),
    ...(op === undefined ? {} : { op }),
    ...(resource === undefined ? {} : { resource }),
    ...(method === undefined ? {} : { method, safe: method === SAFE_METHOD || op === SAFE_OP }),
    ...(input === undefined ? {} : { input }),
    origin: pipelineCopy(node.origin),
  };
}

function surfaceOf(node: TreeNode): string {
  let at = node;
  while (at.parent !== undefined) at = at.parent;
  return at.name;
}

// The method a route writes, an op's own or `conventions.ops.<op>.method`; a relay route's is copied.
function methodOf(
  node: TreeNode,
  op: IrWriter.OpShorthand | undefined,
  context: TreeNodesContext,
): IrWriter.HttpMethod | undefined {
  if (node.kind === "relay") return undefined;

  const own = Object.hasOwn(node.settings, "method") ? node.settings.method : undefined;
  const method =
    own ?? (op === undefined ? undefined : context.conventions.get(`ops.${op}.method`)?.value);
  if (!isHttpMethod(method))
    throw new Error(`the operation at ${node.pointer} has no method the grammar admits`);
  return method;
}

// The collection or single an operation belongs to (its nearest one), with the member id parameter when the
// operation sits on the member scope, and the item property holding the id: `idProperty`, else the id parameter.
function resourceOf(node: TreeNode): IrWriter.OperationResource | undefined {
  let onMember = false;
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (at.kind === "scope") onMember = at.name === "member";
    if (at.kind !== "collection" && at.kind !== "single") continue;

    const written = Object.hasOwn(at.settings, "resourceType")
      ? at.settings.resourceType
      : undefined;
    const type = typeof written === "string" ? written : at.name;
    if (at.kind === "single") return { type };

    const idParam = treeNodesIdParam(at);
    const idPropertyWritten = Object.hasOwn(at.settings, "idProperty")
      ? at.settings.idProperty
      : undefined;
    const idProperty = typeof idPropertyWritten === "string" ? idPropertyWritten : idParam;
    return {
      type,
      ...(onMember && idParam !== undefined ? { idParam } : {}),
      ...(idProperty === undefined ? {} : { idProperty }),
    };
  }
  return undefined;
}

// ADR 0002 section 6: the singular comes from `singular` or `id` only. Reported once per collection, at its first
// operation that needs it.
function reportNoSingular(
  node: TreeNode,
  reportedCollections: Set<string>,
  context: TreeNodesContext,
): void {
  const collection = treeNodesSingularOwner(node);
  if (collection === undefined)
    throw new Error(`the operation at ${node.pointer} has no name, yet needs no singular`);
  if (reportedCollections.has(collection.pointer)) return;
  reportedCollections.add(collection.pointer);

  context.report(
    treeNodesError({
      rule: "collection-singular",
      origin: treeNodesNodeOrigin(collection.origin),
      message: `The collection ${collection.name} declares neither singular nor id, so the operation at ${node.pointer} has no singular noun for its name.`,
      fix: "Set singular on the collection (or declare its id).",
    }),
  );
}

// ADR 0002 section 6 and ADR 0007 section 2: ids are unique across the api, and two operations whose names give
// equal segments would collide in every language.
function reportClashes(written: readonly Written[], context: TreeNodesContext): void {
  const byId = new Map<string, Written>();
  const bySegments = new Map<string, Written>();

  for (const entry of written) {
    const { id, name } = entry.name;

    const sameId = byId.get(id);
    if (sameId !== undefined) {
      reportClash(entry, sameId, "operation-id-unique", context);
      continue;
    }
    byId.set(id, entry);

    const segments = name.segments.join(" ");
    const sameName = bySegments.get(segments);
    if (sameName !== undefined) reportClash(entry, sameName, "operation-name-unique", context);
    else bySegments.set(segments, entry);
  }
}

function reportClash(
  entry: Written,
  first: Written,
  rule: "operation-id-unique" | "operation-name-unique",
  context: TreeNodesContext,
): void {
  const id = entry.name.id;
  const firstId = first.name.id;
  const message =
    rule === "operation-id-unique"
      ? `The operation id ${id} of ${entry.node.pointer} is also the id of ${first.node.pointer}; operation ids are unique across the api.`
      : `The operation ${id} of ${entry.node.pointer} has the same name words as ${firstId} of ${first.node.pointer}, so the two collide in every language.`;
  context.report(
    treeNodesError({
      rule,
      origin: treeNodesNodeOrigin(entry.node.origin),
      message,
      fix: "Rename one of the routes, or set operationId on one of them.",
      related: [
        { origin: treeNodesNodeOrigin(first.node.origin), message: `the operation ${firstId}` },
      ],
    }),
  );
}
