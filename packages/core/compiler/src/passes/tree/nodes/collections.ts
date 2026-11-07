import { type DraftIR, pipelineTreeNodes, type TreeNode } from "../../../pipeline/seam.js";
import { type TreeNodesReportOnce, treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import { treeNodesIdParam } from "./names.js";
import {
  type TreeNodesContext,
  treeNodesAnsweredUse,
  treeNodesObjectOf,
  treeNodesPointer,
  treeNodesSetting,
  treeNodesText,
} from "./raw.js";

// The checks of a collection (ADR 0002 section 6): its member scope needs `id`, the member path parameter, and the
// item property holding the member id (`idProperty`, else the id parameter's name) is a property of its item.

/** Reports, once per collection, an operation in the member scope of a collection without `id`. */
export function treeNodesReportIdlessCollection(
  node: TreeNode,
  collection: TreeNode,
  once: TreeNodesReportOnce,
): void {
  once(
    `collection-id:${collection.pointer}`,
    treeNodesError({
      rule: "collection-id",
      origin: treeNodesNodeOrigin(collection.origin),
      message: `The collection ${collection.name} declares no id, so the operation at ${node.pointer} in its member scope has no member path.`,
      fix: `Declare id on ${collection.name}: its member id path parameter and schema.`,
    }),
  );
}

/** Reports each collection whose item schema has no property named by its `idProperty` (or id parameter). */
export function treeNodesCheckIdProperties(draft: DraftIR, context: TreeNodesContext): void {
  for (const collection of pipelineTreeNodes(context.raw)) {
    if (collection.kind !== "collection") continue;

    const written = treeNodesText(collection, "idProperty");
    const idProperty = written ?? treeNodesIdParam(collection, context.raw.merged.schemas);

    if (idProperty === undefined || !Object.hasOwn(collection.settings, "item")) continue;

    const itemUse = treeNodesAnsweredUse(context, `${collection.pointer}/item`, "output");
    const item = treeNodesObjectOf(draft, itemUse);

    if (item === undefined || item.properties.some(({ name }) => name === idProperty)) continue;

    const at = idPropertyPointer(collection, idProperty, written);

    context.report(
      treeNodesError({
        rule: "id-property",
        origin: treeNodesNodeOrigin(context.origin(at) ?? collection.origin),
        message: `The item ${item.id} of the collection ${collection.name} has no property ${idProperty} to hold the member id.`,
        fix: "Set idProperty to the item property that holds the id, or add that property to the item.",
      }),
    );
  }
}

// `idProperty` when written, else the id parameter: its `id` entry, or the schema name `id` writes.
function idPropertyPointer(
  collection: TreeNode,
  idProperty: string,
  written: string | undefined,
): string {
  if (written !== undefined) return `${collection.pointer}/idProperty`;

  const idPointer = `${collection.pointer}/id`;

  if (typeof treeNodesSetting(collection, "id") === "string") return idPointer;

  return treeNodesPointer(idPointer, idProperty);
}
