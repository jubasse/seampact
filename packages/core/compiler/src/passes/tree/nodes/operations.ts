import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftIR,
  type DraftOperation,
  pipelineCopy,
  pipelineTreeNodes,
  type TreeNode,
} from "../../../pipeline/seam.js";
import type { TreeNodesSurfacePrefixes } from "./api.js";
import { treeNodesDocs } from "./api.js";
import { treeNodesReportIdlessCollection } from "./collections.js";
import { treeNodesDegradable } from "./degradable.js";
import {
  type TreeNodesReportOnce,
  treeNodesError,
  treeNodesNodeOrigin,
  treeNodesReportOnce,
} from "./diagnostics.js";
import { treeNodesExamples } from "./examples.js";
import type { TreeNodesSite } from "./fields.js";
import { treeNodesBatchInput, treeNodesInput } from "./input.js";
import {
  treeNodesBudgetMs,
  treeNodesCheckSuccessor,
  treeNodesDeprecated,
  treeNodesExtensions,
  treeNodesInternal,
  treeNodesStatedMaturity,
  treeNodesTags,
  treeNodesUpstream,
} from "./lifecycle.js";
import {
  type TreeNodesOperationName,
  type TreeNodesRawSchemas,
  treeNodesIdlessCollection,
  treeNodesIdParam,
  treeNodesIsOperation,
  treeNodesOperationName,
  treeNodesOpShorthand,
  treeNodesSingularOwner,
} from "./names.js";
import { treeNodesPaging } from "./paging.js";
import { treeNodesParams, treeNodesUnknownQuery } from "./params.js";
import { treeNodesCheckPathParts, treeNodesPath } from "./paths.js";
import { type TreeNodesContext, treeNodesSetting } from "./raw.js";
import { treeNodesFormat, treeNodesIsList, treeNodesResponses } from "./responses.js";
import { treeNodesConcurrency, treeNodesOwner } from "./writes.js";

// The operations of the api (ADR 0002 sections 6 and 7): one per route, relay route and `ops` entry, in tree order,
// each with its id, name, surface, op, resource, method, path, safety, declared parameters, input and responses,
// format and origin. A relay route's method, path, format and shape are copied from the public operation it relays.

const OPERATION_KIND = "httpOperation";

const HTTP_METHODS: readonly IrWriter.HttpMethod[] = ["get", "post", "put", "patch", "delete"];

// ADR 0002 section 6: a batch is a safe read sent as POST.
const SAFE_OP: IrWriter.OpShorthand = "batch";
const SAFE_METHOD: IrWriter.HttpMethod = "get";

// ADR 0002 section 6: the item schema holds fields a client never sends, so these ops have no default input.
const OPS_NEEDING_INPUT: readonly IrWriter.OpShorthand[] = ["create", "update"];

const isHttpMethod = (value: unknown): value is IrWriter.HttpMethod =>
  HTTP_METHODS.some((method) => method === value);

/** An operation written to the draft, with the node it came from, its name and its route when it has one. */
interface Written {
  readonly node: TreeNode;
  readonly name: TreeNodesOperationName;
  readonly route: Route | undefined;
}

interface Route {
  /** The method and the path, each placeholder compared by position only. */
  readonly key: string;
  readonly text: string;
}

/** Writes every operation of the api to the draft, in tree order, and reports the id and name clashes. */
export function treeNodesOperations(
  draft: DraftIR,
  context: TreeNodesContext,
  prefixes: TreeNodesSurfacePrefixes,
): void {
  const written: Written[] = [];
  const once = treeNodesReportOnce((diagnostic) => context.report(diagnostic));

  for (const node of pipelineTreeNodes(context.raw)) {
    if (!treeNodesIsOperation(node)) continue;

    const idlessCollection = treeNodesIdlessCollection(node);

    if (idlessCollection !== undefined) {
      treeNodesReportIdlessCollection(node, idlessCollection, once);
      continue;
    }

    const name = treeNodesOperationName(node, context.conventions, context.raw.merged.schemas);

    if (name === undefined) {
      reportNoSingular(node, once);
      continue;
    }

    const site: TreeNodesSite = { node, operationId: name.id, draft, context, once };
    const operation = operationOf(site, name, prefixes);

    draft.operations.push(operation);
    const route = memberIdFailed(node, context) ? undefined : routeOf(operation);

    written.push({ node, name, route });
  }

  reportClashes(written, context);
  reportRouteClashes(written, context);
  checkSuccessors(draft, context);
}

// A successor names an operation of this api, known once every operation is written.
function checkSuccessors(draft: DraftIR, context: TreeNodesContext): void {
  const ids = new Set(draft.operations.flatMap((operation) => operation.id ?? []));

  for (const operation of draft.operations)
    if (operation.deprecated !== undefined && operation.id !== undefined)
      treeNodesCheckSuccessor({ context, operationId: operation.id }, operation.deprecated, ids);
}

// A member route under a collection whose `id` gives no parameter has no placeholder in its path; the `id` is
// already refused, so comparing that path would only repeat the error as a route clash.
function memberIdFailed(node: TreeNode, context: TreeNodesContext): boolean {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    const collection = at.kind === "scope" && at.name === "member" ? at.parent : undefined;

    if (collection !== undefined && Object.hasOwn(collection.settings, "id"))
      return treeNodesIdParam(collection, context.raw.merged.schemas) === undefined;
  }

  return false;
}

// The method and the path, each placeholder compared by position only: `/tasks/{id}` and `/tasks/{taskId}` are one
// route to a router, `/tasks/me` beside `/tasks/{id}` is not. Undefined for a relay route until its path
// is copied.
function routeOf(operation: DraftOperation): Route | undefined {
  if (operation.method === undefined || operation.path === undefined) return undefined;
  const method = operation.method.toUpperCase();

  return {
    key: `${method} ${operation.path.replace(/\{[^{}]+\}/g, "{}")}`,
    text: `${method} ${operation.path}`,
  };
}

// ADR 0006 section 3: two operations of one api never share a method and a path, whatever their origin.
function reportRouteClashes(written: readonly Written[], context: TreeNodesContext): void {
  const byRoute = new Map<string, Written>();

  for (const entry of written) {
    if (entry.route === undefined) continue;
    const first = byRoute.get(entry.route.key);

    if (first?.route === undefined) {
      byRoute.set(entry.route.key, entry);
      continue;
    }

    context.report(
      treeNodesError({
        rule: "route-unique",
        origin: treeNodesNodeOrigin(entry.node.origin),
        message: `The operation ${entry.name.id} answers ${entry.route.text}, which a router cannot tell from ${first.route.text} of ${first.name.id}.`,
        fix: "Change the path or the method of one of the two routes.",
        related: [
          {
            origin: treeNodesNodeOrigin(first.node.origin),
            message: `the operation ${first.name.id}`,
          },
        ],
      }),
    );
  }
}

function operationOf(
  site: TreeNodesSite,
  name: TreeNodesOperationName,
  prefixes: TreeNodesSurfacePrefixes,
): DraftOperation {
  const { node, draft, context } = site;
  const op = treeNodesOpShorthand(node);
  const resource = resourceOf(node, context.raw.merged.schemas);
  const method = methodOf(node, op, site);
  const safe = method === SAFE_METHOD || op === SAFE_OP;
  const input =
    op === SAFE_OP && treeNodesSetting(node, "input") === undefined
      ? treeNodesBatchInput(node, context)
      : treeNodesInput(node, name.id, draft, context);

  if (
    op !== undefined &&
    OPS_NEEDING_INPUT.includes(op) &&
    treeNodesSetting(node, "input") === undefined
  )
    reportNoInput(site, op);

  const path = treeNodesPath(node, prefixes, context);

  if (path !== undefined) treeNodesCheckPathParts(site, path);
  const params = treeNodesParams(site, path, safe, input?.schema);

  return {
    kind: OPERATION_KIND,
    id: name.id,
    name: pipelineCopy(name.name),
    surface: surfaceOf(node),
    ...(op === undefined ? {} : { op }),
    ...(resource === undefined ? {} : { resource }),
    ...(method === undefined ? {} : { method, safe }),
    ...(path === undefined ? {} : { path: path.full }),
    params,
    unknownQuery: treeNodesUnknownQuery(site),
    ...(input === undefined ? {} : { input }),
    // A relay route's shape (format, responses, write semantics, paging) is copied from the operation it relays.
    ...(node.kind === "relay" ? { responses: [] } : shapeOf(site, input?.schema, params)),
    ...lifecycleOf(site, op === SAFE_OP),
    origin: pipelineCopy(node.origin),
  };
}

// The members a route's own shape gives: format, responses, write semantics, paging, degradable and examples.
function shapeOf(
  site: TreeNodesSite,
  input: IrWriter.TypeUse | undefined,
  params: IrWriter.Params,
): DraftOperation {
  const format = treeNodesFormat(site);
  const responses = treeNodesResponses(site, format);
  const queryNames = params.query.map((param) => param.name);
  const headerNames = params.header.map((param) => param.name);
  const isList = treeNodesIsList(site.node);
  const item = isList ? responses.find((response) => response.body !== undefined)?.body : undefined;
  const owner = treeNodesOwner(site);
  const concurrency = treeNodesConcurrency(site, input, queryNames, headerNames);
  const paging = treeNodesPaging(site, isList, item, queryNames);
  const degradable = treeNodesDegradable(site, format, responses);

  return {
    responses,
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(owner === undefined ? {} : { owner }),
    ...(paging === undefined ? {} : { paging }),
    ...(degradable === undefined ? {} : { degradable }),
    format,
    examples: treeNodesExamples(site, input, responses),
  };
}

// The lifecycle members (ADR 0002 section 10), docs and extensions, on every operation, a relay route's too.
function lifecycleOf(site: TreeNodesSite, isBatch: boolean): DraftOperation {
  const budgetMs = treeNodesBudgetMs(site, isBatch);
  const deprecated = treeNodesDeprecated(site);
  const maturity = treeNodesStatedMaturity(site);

  return {
    ...(budgetMs === undefined ? {} : { budgetMs }),
    ...(deprecated === undefined ? {} : { deprecated }),
    upstream: treeNodesUpstream(site),
    ...(maturity === undefined ? {} : { maturity }),
    internal: treeNodesInternal(site),
    tags: treeNodesTags(site),
    ...(site.node.kind === "relay" ? { examples: {} } : {}),
    docs: treeNodesDocs(site.node.settings),
    extensions: treeNodesExtensions(site.node),
  };
}

function reportNoInput(site: TreeNodesSite, op: IrWriter.OpShorthand): void {
  site.context.report(
    treeNodesError({
      rule: "op-input",
      origin: treeNodesNodeOrigin(site.node.origin),
      message: `The ${op} op ${site.operationId} has no input; the item schema holds fields a client never sends.`,
      fix: `Declare input on the ${op} op.`,
    }),
  );
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
  { context }: TreeNodesSite,
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
function resourceOf(
  node: TreeNode,
  schemas: TreeNodesRawSchemas,
): IrWriter.OperationResource | undefined {
  let onMember = false;

  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (at.kind === "scope") onMember = at.name === "member";

    if (at.kind !== "collection" && at.kind !== "single") continue;

    const written = Object.hasOwn(at.settings, "resourceType")
      ? at.settings.resourceType
      : undefined;
    const type = typeof written === "string" ? written : at.name;

    if (at.kind === "single") return { type };

    const idParam = treeNodesIdParam(at, schemas);
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
function reportNoSingular(node: TreeNode, once: TreeNodesReportOnce): void {
  const collection = treeNodesSingularOwner(node);

  if (collection === undefined)
    throw new Error(`the operation at ${node.pointer} has no name, yet needs no singular`);

  once(
    `collection-singular:${collection.pointer}`,
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
