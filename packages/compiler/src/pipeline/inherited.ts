import type { Origin } from "@seampact/spec/ir";
import type { JsonValue, RawApi } from "../raw-tree.js";
import { isJsonList, isJsonObject, jsonAt, pipelineOrigin, pointerBelow } from "./pointer.js";
import type { PassReadonly } from "./readonly.js";
import type { TreeNode } from "./tree.js";

// The inherited settings of ADR 0002 section 8 and the merge shape of each (ADR 0006 section 2). `inherited`
// applies the merge and returns each value with the origin of the node that set it; it reports nothing: the
// conflict diagnostics and the filters (`query` on safe routes, `errors` within `reach` and `for`, pack-derived
// requirements first) belong to the half that owns the setting. `errors` is the one union `inherited` does not
// reduce: an equal attachment on a nested node is kept, because `reach` and `for` apply per attachment (ADR 0002
// section 11), so derive.errors filters each attachment first and then unions by code. A setting ADR 0002 section 8 does not inherit
// (`owner`, `concurrency`, `paging`, `examples`, ...) is not a `SettingName`, so asking for it fails to compile.

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

/**
 * The union of the entries of every node, from the root down to the node. For `errors`, every attachment is kept
 * (derive.errors unions by code after its `reach` and `for` filter).
 */
export type UnionSetting = "principal.requires" | "errors" | "tags";

export type SettingName = NearestSetting | PerKeySetting | OrderedSetting | UnionSetting;

/** A value with the origin of the node that set it. */
export interface InheritedEntry {
  /** The raw value (read-only when the raw tree is): a whole setting, one list item, or one map entry's value. */
  readonly value: PassReadonly<JsonValue>;
  /** The map key of an entry of a map-valued setting (`scopes`, `bindings`, `headers`, `errors`, ...). */
  readonly key?: string;
  readonly origin: Origin;
  readonly node: TreeNode;
}

export interface InheritedNearest {
  readonly shape: "nearest";
  readonly entry: InheritedEntry;
}

export interface InheritedPerKey {
  readonly shape: "perKey";
  /** Each key with the entry of the nearest node that set it, in first-set order. */
  readonly entries: ReadonlyMap<string, InheritedEntry>;
}

export interface InheritedList {
  readonly shape: "ordered" | "union";
  /**
   * Each entry with its node, from the root down to the node, in written order within a node: a list's items, a
   * map's entries (with `key`), or a whole value of another form (a fields map written as a schema name). For
   * `tags` and `principal.requires`, an entry equal to an earlier one (same key, and the same value whatever its
   * key order) is dropped, so the first setter's origin stays. For `errors`, every attachment from the root down
   * to the node is kept with its node and origin, equal ones included: an equal attachment on a nested node with
   * `reach: resource` reaches where the root's does not, so the owning half filters each one before the union.
   */
  readonly entries: readonly InheritedEntry[];
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

// The shape of each setting at run time; the type tests below keep the lists equal to the unions above.
const NEAREST = [
  "identity",
  "access",
  "upstream",
  "maturity",
  "internal",
  "deprecated",
  "budget",
  "bodyLimit",
  "cache",
  "csrf",
  "idempotency",
  "format",
  "unknownQuery",
] as const satisfies readonly NearestSetting[];
const ORDERED = [
  "requires",
  "scopes",
  "bindings",
  "headers",
  "query",
  "lint.allow",
] as const satisfies readonly OrderedSetting[];
const UNION = ["principal.requires", "errors", "tags"] as const satisfies readonly UnionSetting[];

type Missing<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : Exclude<All, Listed>;
const covered: [
  Missing<NearestSetting, (typeof NEAREST)[number] | `x-${string}`>,
  Missing<OrderedSetting, (typeof ORDERED)[number]>,
  Missing<UnionSetting, (typeof UNION)[number]>,
] = [true, true, true];
void covered;

// A name outside the unions (a cast, or JavaScript) throws instead of reading as some shape.
function shapeOf(setting: string): "nearest" | "perKey" | "ordered" | "union" {
  const listed = (list: readonly string[]): boolean => list.includes(setting);
  if (setting.startsWith("x-") || listed(NEAREST)) return "nearest";
  if (setting === "errorRoles") return "perKey";
  if (listed(ORDERED)) return "ordered";
  if (listed(UNION)) return "union";
  throw new Error(`setting ${setting} has no merge shape: ADR 0002 section 8 does not inherit it`);
}

/**
 * The inherited-setting reader of one api (ADR 0002 section 8): `inherited(node, setting)` merges the setting
 * from the root down to `node` by its shape and returns each value with the origin of the node that set it. It
 * reports nothing and filters nothing (section 2 of ADR 0006: the owning half does), and `errorRoles` does not
 * fall back to `conventions.errors.derived` (read that through `ResolvedConventions`). Results are frozen.
 */
export function pipelineInherited(raw: PassReadonly<RawApi>): InheritedReader {
  const entryOf = (
    node: TreeNode,
    path: readonly string[],
    value: PassReadonly<JsonValue>,
    key?: string | number,
  ): InheritedEntry => {
    const pointer = pointerBelow(node.pointer, ...path, ...(key === undefined ? [] : [key]));
    const origin = pipelineOrigin(raw, pointer) ?? { ...node.origin };
    return Object.freeze({
      value,
      ...(typeof key === "string" ? { key } : {}),
      origin: Object.freeze(origin),
      node,
    });
  };

  function read<S extends SettingName>(node: TreeNode, setting: S): Inherited<S> | undefined;
  function read(node: TreeNode, setting: SettingName): Inherited<SettingName> | undefined {
    const shape = shapeOf(setting);
    const path = setting.startsWith("x-") ? [setting] : setting.split(".");
    const chain: TreeNode[] = [];
    for (let at: TreeNode | undefined = node; at !== undefined; at = at.parent) chain.unshift(at);
    const written = chain.flatMap((at) => {
      const value = jsonAt(at.settings, path);
      return value === undefined ? [] : [{ at, value }];
    });
    const nearest = written[written.length - 1];
    if (nearest === undefined) return undefined;

    if (shape === "nearest")
      return Object.freeze({ shape, entry: entryOf(nearest.at, path, nearest.value) });
    if (shape === "perKey") {
      const entries = new Map<string, InheritedEntry>();
      for (const { at, value } of written) {
        if (!isJsonObject(value)) continue;
        for (const [key, item] of Object.entries(value))
          entries.set(key, entryOf(at, path, item, key));
      }
      return Object.freeze({ shape, entries: readonlyMap(entries) });
    }
    const entries: InheritedEntry[] = [];
    for (const { at, value } of written) {
      if (isJsonList(value))
        for (const [i, item] of value.entries()) entries.push(entryOf(at, path, item, i));
      else if (isJsonObject(value))
        for (const [key, item] of Object.entries(value)) entries.push(entryOf(at, path, item, key));
      else entries.push(entryOf(at, path, value));
    }
    // `errors` is reduced by derive.errors, after it filters each attachment (see the module comment).
    if (shape === "ordered" || setting === "errors")
      return Object.freeze({ shape, entries: Object.freeze(entries) });
    const seen = new Set<string>();
    const union = entries.filter((entry) => {
      const id = canonical([entry.key ?? null, entry.value]);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return Object.freeze({ shape, entries: Object.freeze(union) });
  }
  return read;
}

// A value's text with every object's keys sorted, so two equal values written in another key order are one.
function canonical(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted);
    if (typeof item !== "object" || item === null) return item;
    return Object.fromEntries(
      Object.keys(item)
        .sort()
        .map((key) => [key, sorted(Reflect.get(item, key))]),
    );
  };
  return JSON.stringify(sorted(value));
}

// A map no caller can change: a frozen object over a private `Map`, since freezing a `Map` leaves `set` working.
function readonlyMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
  const view: ReadonlyMap<K, V> = {
    get size() {
      return map.size;
    },
    get: (key) => map.get(key),
    has: (key) => map.has(key),
    forEach: (callback, thisArg?: unknown) =>
      map.forEach((value, key) => {
        callback.call(thisArg, value, key, view);
      }),
    entries: () => map.entries(),
    keys: () => map.keys(),
    values: () => map.values(),
    [Symbol.iterator]: () => map[Symbol.iterator](),
  };
  return Object.freeze(view);
}
