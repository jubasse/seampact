import type { Origin } from "@seampact/spec/ir";
import type { JsonValue } from "../raw-tree.js";
import type { TreeNode } from "./tree.js";

// The inherited settings of ADR 0002 section 8 and the merge shape of each (ADR 0006 section 2). `inherited`
// applies the merge and returns each value with the origin of the node that set it; it reports nothing: the
// conflict diagnostics and the filters (`query` on safe routes, `errors` within `reach` and `for`, pack-derived
// requirements first) belong to the half that owns the setting. A setting ADR 0002 section 8 does not inherit
// (`owner`, `concurrency`, `paging`, `examples`, ...) is not a `SettingName`, so asking for it fails to compile.
// PR 2 of p2-pipeline adds the implementation.

/** The nearest node that sets it wins. */
export type NearestSetting =
  | "identity"
  | "access"
  | "upstream"
  | "maturity"
  | "internal"
  | "deprecated"
  | "budget"
  | "bodyLimit"
  | "cache"
  | "csrf"
  | "idempotency"
  | "format"
  | "unknownQuery"
  | `x-${string}`;

/** Per key, the nearest node that sets it wins. */
export type PerKeySetting = "errorRoles";

/** Every entry, ordered from the root down to the node. */
export type OrderedSetting =
  | "requires"
  | "scopes"
  | "bindings"
  | "headers"
  | "query"
  | "lint.allow";

/** The union of the entries of every node, from the root down to the node. */
export type UnionSetting = "principal.requires" | "errors" | "tags";

export type SettingName = NearestSetting | PerKeySetting | OrderedSetting | UnionSetting;

/** A value with the origin of the node that set it. */
export interface InheritedEntry {
  value: JsonValue;
  origin: Origin;
  node: TreeNode;
}

export interface InheritedNearest {
  shape: "nearest";
  entry: InheritedEntry;
}

export interface InheritedPerKey {
  shape: "perKey";
  /** Each key with the entry of the nearest node that set it. */
  entries: ReadonlyMap<string, InheritedEntry>;
}

export interface InheritedList {
  shape: "ordered" | "union";
  /** Each entry with its node, from the root down to the node, in written order within a node. */
  entries: readonly InheritedEntry[];
}

export type Inherited<S extends SettingName> = S extends NearestSetting
  ? InheritedNearest
  : S extends PerKeySetting
    ? InheritedPerKey
    : InheritedList;

/** Reads an inherited setting at a node: undefined when no node from the root to it sets it. */
export type InheritedReader = <S extends SettingName>(
  node: TreeNode,
  setting: S,
) => Inherited<S> | undefined;
