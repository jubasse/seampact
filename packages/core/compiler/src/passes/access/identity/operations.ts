import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftIR,
  type DraftOperation,
  pipelineTreeNodes,
  type TreeNode,
} from "../../../pipeline/seam.js";
import {
  type AccessIdentityBuilt,
  type AccessIdentityRoute,
  type AccessIdentityScope,
  accessIdentityAccess,
  accessIdentityCallerKinds,
  accessIdentityServiceNodes,
} from "./access.js";
import { accessIdentityBindings, accessIdentityPrincipalRequires } from "./bindings.js";
import { accessIdentityCsrf } from "./csrf.js";
import { accessIdentityObject, accessIdentityString } from "./read.js";
import { type AccessIdentityReporter, accessIdentityOnceReporter } from "./report.js";
import {
  accessIdentityCheckQuerySchemes,
  accessIdentityCheckSignatureKey,
  accessIdentityInputFacts,
} from "./signed.js";

// The per-operation members of the half (ADR 0004 section 7): each operation tree.nodes wrote, matched back to
// the tree node it was written from, gets its access, caller kinds, CSRF decision, principal requirements and
// bindings, and the raw-body and unknown-key facts of its declared input. An operation whose access is refused
// gets none of them; its error is reported.

type Context = AccessIdentityScope["context"];

// The node kinds tree.nodes writes an operation for: a route, a relay route, an `ops` entry.
const OPERATION_NODE_KINDS: readonly string[] = ["route", "relay", "op"];

const originKey = (origin: IrWriter.Origin): string => `${origin.layer}:${origin.pointer}`;

/** Writes the per-operation members of every operation of the draft. */
export function accessIdentityOperations(
  draft: DraftIR,
  context: Context,
  built: AccessIdentityBuilt,
  catalogueReporter: AccessIdentityReporter,
): void {
  const reporter = accessIdentityOnceReporter(catalogueReporter);
  const nodes = pipelineTreeNodes(context.raw);
  const caller = serviceCaller(context);
  if (caller !== undefined) accessIdentityServiceNodes(nodes, caller, reporter);

  const scope: AccessIdentityScope = {
    context,
    built,
    schemas: draft.schemas,
    ...(caller === undefined ? {} : { caller }),
    reporter,
  };
  const nodeByOrigin = operationNodes(nodes);

  for (const operation of draft.operations) {
    const route = routeOf(operation, nodeByOrigin);
    writeOperation(route, scope);
  }
}

function writeOperation(route: AccessIdentityRoute, scope: AccessIdentityScope): void {
  const resolved = accessIdentityAccess(route, scope);
  if (resolved === undefined) return;

  const operation = route.operation;
  operation.access = resolved.access;
  operation.callerKinds = accessIdentityCallerKinds(resolved.access);

  const csrf = accessIdentityCsrf(route, resolved, scope);
  if (csrf !== undefined) operation.csrf = csrf;

  operation.principalRequires = accessIdentityPrincipalRequires(route, resolved, scope);
  operation.bindings = accessIdentityBindings(route, resolved, scope);

  accessIdentityCheckSignatureKey(route, resolved, scope);
  accessIdentityCheckQuerySchemes(route, resolved, scope);
  writeInputFacts(operation, resolved.identity);
}

function writeInputFacts(operation: DraftOperation, identity: IrWriter.KnownIdentity | undefined): void {
  const facts = accessIdentityInputFacts(operation, identity);
  const input = operation.input;
  if (facts === undefined || input === undefined) return;

  input.rawBody = facts.rawBody;
  if (facts.unknownKeys !== undefined && input.schema.kind === "ref") input.schema.unknownKeys = facts.unknownKeys;
}

// ADR 0002 section 5: a service api names its caller identity at `api.caller.identity`.
function serviceCaller(context: Context): string | undefined {
  const api = accessIdentityObject(context.raw.merged, "api");
  const caller = api === undefined ? undefined : accessIdentityObject(api, "caller");
  return caller === undefined ? undefined : accessIdentityString(caller, "identity");
}

function operationNodes(nodes: readonly TreeNode[]): Map<string, TreeNode> {
  const byOrigin = new Map<string, TreeNode>();
  for (const node of nodes) {
    if (!OPERATION_NODE_KINDS.includes(node.kind)) continue;

    const key = originKey(node.origin);
    if (byOrigin.has(key)) throw new Error(`two operation nodes share the origin ${key}`);
    byOrigin.set(key, node);
  }
  return byOrigin;
}

// tree.nodes writes each operation with its node's origin, an id, and `safe` beside its method.
function routeOf(operation: DraftOperation, nodeByOrigin: ReadonlyMap<string, TreeNode>): AccessIdentityRoute {
  const { id, origin } = operation;
  if (id === undefined || origin === undefined)
    throw new Error("tree.nodes wrote an operation without its id or origin");

  const node = nodeByOrigin.get(originKey(origin));
  if (node === undefined) throw new Error(`operation '${id}' has no tree node at ${originKey(origin)}`);

  return { id, node, safe: operation.safe === true, operation };
}
