import type { Origin } from "@seampact/spec/ir";
import type { JsonObject, RawApi } from "../raw-tree.js";
import { isJsonList, isJsonObject, pipelineOrigin, pointerBelow } from "./pointer.js";
import type { PassReadonly } from "./readonly.js";

// The tree-node model of the merged raw tree (ADR 0002 section 6), which `inherited` walks (ADR 0006 section 2).

/**
 * The kind of a tree node. `scope` is the `collection` or `member` scope of a collection, which exists whether or
 * not it is written; `op` is one entry of an `ops` shorthand, whose parent is its scope (`list`, `create`, `batch`
 * under `collection`, `get`, `update`, `delete` under `member`) or the single it is written on.
 */
export type TreeNodeKind = "surface" | "single" | "collection" | "scope" | "route" | "relay" | "op";

export interface TreeNode {
  readonly kind: TreeNodeKind;
  /** The surface, child, scope (`collection` or `member`) or op name. */
  readonly name: string;
  /**
   * The JSON Pointer of the node in the merged raw tree. A scope not written points where it would be
   * (`.../tasks/member`); an op points at its entry, `.../ops/get` in a mapping and `.../ops/1` in a list, which is
   * also its origin, while its parent is its scope (ADR 0002 section 6, "Collections and singles").
   */
  readonly pointer: string;
  readonly parent?: TreeNode;
  /** The node's mapping as written (an empty object for a scope not written and an op of an `ops` list). */
  readonly settings: PassReadonly<JsonObject>;
  /** The origin of the node: where it is written, or its parent's for a scope not written. */
  readonly origin: Origin;
}

// ADR 0002 section 6: the scope of each op of a collection; a single's ops sit under the single.
const COLLECTION_SCOPE_OPS = {
  collection: ["list", "create", "batch"],
  member: ["get", "update", "delete"],
} as const;

const EMPTY: PassReadonly<JsonObject> = Object.freeze({});

/**
 * Every node of the api's surfaces in document order (ADR 0002 section 6): a node before its children, children in
 * written order; a collection's `collection` scope then its `member` scope, each followed by its op entries (in
 * `ops` order) and then its routes; a single's op entries before its routes. The list and its nodes are frozen,
 * and a node's `settings` is the raw tree's own mapping, read-only when the raw tree handed in is.
 */
export function pipelineTreeNodes(raw: PassReadonly<RawApi>): readonly TreeNode[] {
  const nodes: TreeNode[] = [];
  // `settings` undefined: a scope not written, which takes its parent's origin.
  const add = (
    kind: TreeNodeKind,
    name: string,
    pointer: string,
    parent: TreeNode | undefined,
    settings: PassReadonly<JsonObject> | undefined,
  ): TreeNode => {
    const origin = settings === undefined ? undefined : pipelineOrigin(raw, pointer);
    const fallback: Origin = parent?.origin ?? { layer: "api", pointer };
    const node: TreeNode = Object.freeze({
      kind,
      name,
      pointer,
      ...(parent === undefined ? {} : { parent }),
      settings: settings ?? EMPTY,
      origin: Object.freeze(origin ?? { ...fallback }),
    });

    nodes.push(node);

    return node;
  };

  // The op entries of `owner` that sit under `scope`: every entry of a single, a collection's by its table. A list
  // entry (`ops: [get]`) is written but has no settings; its origin is the entry's.
  const ops = (owner: TreeNode, scope: TreeNode, names: readonly string[] | undefined): void => {
    const written = owner.settings.ops;
    const entries = isJsonList(written)
      ? written.map((op, i) => [op, i, EMPTY] as const)
      : isJsonObject(written)
        ? Object.entries(written).map(([op, value]) => [op, op, value] as const)
        : [];

    for (const [op, key, value] of entries) {
      if (typeof op !== "string" || (names !== undefined && !names.includes(op))) continue;
      add(
        "op",
        op,
        pointerBelow(owner.pointer, "ops", key),
        scope,
        isJsonObject(value) ? value : EMPTY,
      );
    }
  };

  const routes = (parent: TreeNode): void => {
    const children = parent.settings.routes;

    if (!isJsonObject(children)) return;

    for (const [name, child] of Object.entries(children)) {
      if (isJsonObject(child))
        visit(name, pointerBelow(parent.pointer, "routes", name), parent, child);
    }
  };

  const visit = (
    name: string,
    pointer: string,
    parent: TreeNode,
    settings: PassReadonly<JsonObject>,
  ): void => {
    if (Object.hasOwn(settings, "relays")) {
      add("relay", name, pointer, parent, settings);
    } else if (Object.hasOwn(settings, "method")) {
      add("route", name, pointer, parent, settings);
    } else if (settings.kind === "collection") {
      const collection = add("collection", name, pointer, parent, settings);

      for (const scopeName of ["collection", "member"] as const) {
        const written = settings[scopeName];
        const scope = add(
          "scope",
          scopeName,
          pointerBelow(pointer, scopeName),
          collection,
          isJsonObject(written) ? written : undefined,
        );

        ops(collection, scope, COLLECTION_SCOPE_OPS[scopeName]);
        routes(scope);
      }
    } else if (settings.kind === "single") {
      const single = add("single", name, pointer, parent, settings);

      ops(single, single, undefined);
      routes(single);
    }
  };

  const surfaces = raw.merged.surfaces;

  if (isJsonObject(surfaces)) {
    for (const [name, value] of Object.entries(surfaces)) {
      if (isJsonObject(value))
        routes(add("surface", name, pointerBelow("", "surfaces", name), undefined, value));
    }
  }

  return Object.freeze(nodes);
}
