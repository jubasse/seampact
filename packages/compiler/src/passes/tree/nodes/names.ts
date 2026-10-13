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
// parameter. A collection without `id` has no member id: its name stands for the noun.
function singularWords(collection: TreeNode): string[] {
  const singular = textSetting(collection, "singular");
  if (singular !== undefined) return splitName(singular);

  const idParam = treeNodesIdParam(collection);
  if (idParam === undefined) return splitName(collection.name);

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

// The noun words of an operation node, and the verb words before the order is applied.
function wordsOf(node: TreeNode): { verb: string[]; noun: string[] } {
  if (node.kind === "op") {
    const owner = opOwner(node);
    if (owner === undefined) return { verb: splitName(node.name), noun: [] };
    if (owner.kind === "single") return { verb: splitName(node.name), noun: splitName(owner.name) };

    const plural = PLURAL_OPS.includes(node.name);
    const noun = plural ? splitName(owner.name) : singularWords(owner);
    return node.name === "batch"
      ? { verb: [...BATCH_VERB], noun: [...noun, ...BATCH_SUFFIX] }
      : { verb: splitName(node.name), noun };
  }

  const verb = splitName(node.name);
  const parent = node.parent;
  if (parent === undefined || parent.kind === "surface") return { verb, noun: [] };
  if (parent.kind === "single") return { verb, noun: splitName(parent.name) };

  const collection = parent.kind === "scope" ? parent.parent : undefined;
  if (collection === undefined) return { verb, noun: [] };
  return {
    verb,
    noun: parent.name === "member" ? singularWords(collection) : splitName(collection.name),
  };
}

function idOrder(conventions: ResolvedConventions): IdOrder {
  const order = conventions.get("operationIds.order")?.value;
  return order === "nounVerb" ? "nounVerb" : "verbNoun";
}

function idCase(conventions: ResolvedConventions): OperationIdCase {
  const written = conventions.get("operationIds.case")?.value;
  return written === "snake" ? "snake" : "camel";
}

/** The id and name of one operation node; undefined when its words give no segment (the pass reports it). */
export function treeNodesOperationName(
  node: TreeNode,
  conventions: ResolvedConventions,
): TreeNodesOperationName | undefined {
  const written = textSetting(node, "operationId");
  if (written !== undefined) return named(written, splitName(written));

  if (node.kind === "relay") return named(node.name, splitName(node.name));

  const { verb, noun } = wordsOf(node);
  const segments = idOrder(conventions) === "nounVerb" ? [...noun, ...verb] : [...verb, ...noun];
  if (segments.length === 0) return undefined;
  return named(operationId(segments, idCase(conventions)), segments);
}

function named(id: string, segments: string[]): TreeNodesOperationName | undefined {
  if (segments.length === 0) return undefined;
  return { id, name: { segments, role: ROLE_OPERATION } };
}

/**
 * The id and the name of every operation of the api, keyed by the JSON Pointer of its node in the merged raw tree:
 * the route, the relay route, or the `ops` entry (`.../tasks/ops/get` in a mapping, `.../tasks/ops/1` in a list).
 * Pure: it reads the raw tree and the conventions only, so tree.schemas names inline route schemas with it before
 * tree.nodes runs (ADR 0007 section 3). An operation whose words give no segment is left out; tree.nodes reports it.
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
