import type { IrWriter } from "@seampact/spec/ir";
import { type OperationIdCase, operationId, splitName } from "@seampact/spec/naming";
import {
  type PassReadonly,
  pipelineTreeNodes,
  type ResolvedConventions,
  type TreeNode,
} from "../../../pipeline/seam.js";
import type { RawApi } from "../../../raw-tree.js";

// Operation ids and names (ADR 0002 section 6, ADR 0007 sections 2 and 3). An operation's words are a verb (the op,
// or the route name) and a noun (the plural, the singular, a single's name, or none under a surface root);
// `conventions.operationIds.order` puts them in order, `case` spells the id. `operationId` replaces both, and a
// relay route's name is the public operation id, so its words are its own name's.

/** The id and the name of one operation. */
export interface TreeNodesOperationName {
  readonly id: string;
  readonly name: IrWriter.Name;
}

type IdOrder = "verbNoun" | "nounVerb";

const ROLE_OPERATION = "operation";

// ADR 0002 section 6: the batch op reads as `get` + plural + `Batch` (`getTasksBatch`).
const BATCH_VERB = ["get"];
const BATCH_SUFFIX = ["batch"];

// The id parameter suffix the singular drops (`taskId` gives `task`).
const ID_SUFFIX = "Id";

// The ops whose noun is the plural; the others take the singular.
const PLURAL_OPS: readonly string[] = ["list", "batch"];

/** Whether a tree node is an operation: a route, a relay route or an `ops` entry. */
export const treeNodesIsOperation = (node: TreeNode): boolean =>
  node.kind === "route" || node.kind === "relay" || node.kind === "op";

const textSetting = (node: TreeNode, key: string): string | undefined => {
  const value = Object.hasOwn(node.settings, key) ? node.settings[key] : undefined;
  return typeof value === "string" ? value : undefined;
};

/** The id parameter of a collection: the one key of its `id` fields map. */
export function treeNodesIdParam(collection: TreeNode): string | undefined {
  const id = Object.hasOwn(collection.settings, "id") ? collection.settings.id : undefined;
  if (typeof id !== "object" || id === null || Array.isArray(id)) return undefined;
  return Object.keys(id)[0];
}

// The singular of a collection: `singular`, else the id parameter without its `Id` suffix, else the whole
// parameter; undefined when it declares neither (ADR 0002 section 6 gives no third source).
function singularWords(collection: TreeNode): string[] | undefined {
  const singular = textSetting(collection, "singular");
  if (singular !== undefined) return splitName(singular);

  const idParam = treeNodesIdParam(collection);
  if (idParam === undefined) return undefined;

  const stem =
    idParam.endsWith(ID_SUFFIX) && idParam.length > ID_SUFFIX.length
      ? idParam.slice(0, -ID_SUFFIX.length)
      : idParam;
  return splitName(stem);
}

// The collection or single an op entry belongs to: an op's parent is its scope, or the single it is written on.
function opOwner(op: TreeNode): TreeNode | undefined {
  const parent = op.parent;
  return parent?.kind === "scope" ? parent.parent : parent;
}

/**
 * The collection whose singular names an operation node: the collection of a member-scope route or of an op that
 * reads one record. Undefined when the noun is a plural, a single's name or none.
 */
export function treeNodesSingularOwner(node: TreeNode): TreeNode | undefined {
  if (node.kind === "op") {
    const owner = opOwner(node);
    return owner?.kind === "collection" && !PLURAL_OPS.includes(node.name) ? owner : undefined;
  }

  const parent = node.parent;
  return parent?.kind === "scope" && parent.name === "member" ? parent.parent : undefined;
}

interface Words {
  readonly verb: string[];
  readonly noun: string[];
}

// The verb and noun words of an operation node, before the order is applied; undefined when the noun is the
// singular of a collection that gives none.
function wordsOf(node: TreeNode): Words | undefined {
  const singularOwner = treeNodesSingularOwner(node);
  if (singularOwner === undefined) return node.kind === "op" ? opWords(node) : routeWords(node);

  const noun = singularWords(singularOwner);
  return noun === undefined ? undefined : { verb: splitName(node.name), noun };
}

// An op reading several records: the single's name, or the collection's plural (`getTasksBatch` for a batch).
function opWords(op: TreeNode): Words {
  const owner = opOwner(op);
  if (owner === undefined) return { verb: splitName(op.name), noun: [] };

  const noun = splitName(owner.name);
  return op.name === "batch" && owner.kind === "collection"
    ? { verb: [...BATCH_VERB], noun: [...noun, ...BATCH_SUFFIX] }
    : { verb: splitName(op.name), noun };
}

// A route off the member scope: the single's name, the collection's plural, or none under a surface root.
function routeWords(route: TreeNode): Words {
  const verb = splitName(route.name);
  const parent = route.parent;
  if (parent?.kind === "single") return { verb, noun: splitName(parent.name) };

  const collection = parent?.kind === "scope" ? parent.parent : undefined;
  return { verb, noun: collection === undefined ? [] : splitName(collection.name) };
}

function idOrder(conventions: ResolvedConventions): IdOrder {
  const order = conventions.get("operationIds.order")?.value;
  if (order === "verbNoun" || order === "nounVerb") return order;
  throw new Error(
    `conventions.operationIds.order resolves to ${String(order)}, no order the grammar admits`,
  );
}

function idCase(conventions: ResolvedConventions): OperationIdCase {
  const written = conventions.get("operationIds.case")?.value;
  if (written === "camel" || written === "snake") return written;
  throw new Error(
    `conventions.operationIds.case resolves to ${String(written)}, no case the grammar admits`,
  );
}

/**
 * The id and name of one operation node; undefined when its noun is the singular of a collection that declares
 * neither `singular` nor `id` (the pass reports it).
 */
export function treeNodesOperationName(
  node: TreeNode,
  conventions: ResolvedConventions,
): TreeNodesOperationName | undefined {
  const written = textSetting(node, "operationId");
  if (written !== undefined) return named(node, written, splitName(written));

  if (node.kind === "relay") return named(node, node.name, splitName(node.name));

  const words = wordsOf(node);
  if (words === undefined) return undefined;
  const { verb, noun } = words;
  const segments = idOrder(conventions) === "nounVerb" ? [...noun, ...verb] : [...verb, ...noun];
  return named(node, operationId(segments, idCase(conventions)), segments);
}

// The authoring grammar spells node names and operation ids with a leading letter, so each gives a segment.
function named(node: TreeNode, id: string, segments: string[]): TreeNodesOperationName {
  if (segments.length === 0)
    throw new Error(
      `the operation at ${node.pointer} has a name with no segment, which the grammar refuses`,
    );
  return { id, name: { segments, role: ROLE_OPERATION } };
}

/**
 * The id and the name of every operation of the api, keyed by the JSON Pointer of its node in the merged raw tree:
 * the route, the relay route, or the `ops` entry (`.../tasks/ops/get` in a mapping, `.../tasks/ops/1` in a list).
 * Pure: it reads the raw tree and the conventions only, so tree.schemas names inline route schemas with it before
 * tree.nodes runs (ADR 0007 section 3). An operation whose collection gives no singular for its name is left out;
 * tree.nodes reports it. The ids are not yet checked unique: tree.nodes reports a clash, after tree.schemas.
 */
export function treeNodesOperationNames(
  raw: PassReadonly<RawApi>,
  conventions: ResolvedConventions,
): ReadonlyMap<string, TreeNodesOperationName> {
  const names = new Map<string, TreeNodesOperationName>();
  for (const node of pipelineTreeNodes(raw)) {
    if (!treeNodesIsOperation(node)) continue;
    const name = treeNodesOperationName(node, conventions);
    if (name !== undefined) names.set(node.pointer, name);
  }
  return names;
}
