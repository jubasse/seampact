import { isAlias, isMap, isScalar, isSeq, type Node, type Pair, Scalar, type YAMLMap } from "yaml";
import { diagnosticInert } from "../diagnostics/print.js";
import {
  type ApiLayerId,
  type FileLayerId,
  type JsonObject,
  type JsonValue,
  schemaKindOf,
} from "../raw-tree.js";
import { type LoadBudget, loadWorkOf } from "./budget.js";
import { asObject, cloneJson, isReservedKey, jsonObject, setKey } from "./json.js";
import { LOAD_MAX_DEPTH } from "./limits.js";
import { pointerEscape, pointerSegments } from "./paths.js";
import {
  admitsInteger,
  expectedTypes,
  type MapView,
  NOT_SCALAR,
  type Position,
  positionAt,
  refinePosition,
  refusesScalar,
  rootPosition,
  scalarType,
  stepPosition,
} from "./positions.js";
import type { Reporter, SiteLocation } from "./report.js";
import { loadScalarPitfall } from "./scalars.js";
import { type FileStore, nodeSite, type ParsedFile, pairSite } from "./source.js";

// ADR 0002 section 2: `$include`, `$file` and the file form of `$ref`, expanded over the YAML
// syntax tree so that every merged node keeps the position it was written at.

export interface RefUse {
  name: string;
  at: SiteLocation;
  pointer: string;
}

interface FileRef {
  /** The element's identity, `<real path>#<pointer in the file>`. */
  id: string;
  name: string;
  file: ParsedFile;
  pair: { key: Node | null; value: Node | null };
  at: SiteLocation;
}

/** One layer file, expanded. `locs` maps a layer pointer to where it is written. */
export interface LayerBuild<L extends FileLayerId = ApiLayerId> {
  layer: L;
  parsed: ParsedFile;
  tree: JsonObject;
  locs: Map<string, SiteLocation>;
  uses: RefUse[];
  refs: Map<string, FileRef>;
  /** Refs added since `finishRefs` last looked, in order. */
  pendingRefs: FileRef[];
  /**
   * The file element each schema came from (`/schemas/<name>` to `<real path>#<pointer>`), for
   * those declared by an `$include` under `schemas` or by a file `$ref`. One element reached from
   * two places, or from two layers, is one declaration (ADR 0002 section 2).
   */
  sources: Map<string, string>;
}

/** One file of the `$include`/`$file` chain: `key` is the real path, `shown` the written one. */
interface StackEntry {
  key: string;
  shown: string;
  at: SiteLocation;
}

/** The keys one mapping received, its own and those its `$include`s merged, in order. */
interface MapKeys {
  sites: Map<string, SiteLocation>;
  order: string[];
}

/** A `$file` JSON file, parsed and made safe once per real path, then charged per use. */
type JsonFile =
  | { ok: true; value: JsonValue; nodes: number; text: number; depth: number }
  | { ok: false; error: string };

interface Scope {
  file: ParsedFile;
  /** True in a data position (and below it), one the authoring schema marks `DATA`. */
  data: boolean;
  /** Where the authoring schema places this node (P6); undefined when it says nothing. */
  pos: Position | undefined;
  parentKey: string | undefined;
  stack: StackEntry[];
  /** Nesting level in the merged tree, through includes and `$file`. */
  depth: number;
}

const NULL_SPELLINGS = new Set(["", "~", "Null", "NULL"]);

export function keyString(node: Node | null | undefined): string | undefined {
  if (!isScalar(node)) return undefined;

  if (node.type === Scalar.PLAIN) return node.source ?? String(node.value);

  return String(node.value);
}

function shownTarget(path: string, fragment: string | undefined): string {
  return fragment === undefined || fragment === "" ? path : `${path}#${fragment}`;
}

// A mapping's pairs by key (the first of a duplicated key, as a scan finds it), built once per
// mapping: a lookup by name never rescans a large file for each site that names an element.
const mapIndexes = new WeakMap<YAMLMap, Map<string, Pair>>();

export function mapIndex(map: YAMLMap): Map<string, Pair> {
  let index = mapIndexes.get(map);

  if (!index) {
    index = new Map();

    for (const pair of map.items as Pair[]) {
      const k = keyString(pair.key as Node);

      if (k !== undefined && !index.has(k)) index.set(k, pair);
    }

    mapIndexes.set(map, index);
  }

  return index;
}

export function navigate(file: ParsedFile, fragment: string | undefined): Node | undefined {
  if (!file.root) return undefined;

  if (fragment === undefined || fragment === "") return file.root;
  const segs = pointerSegments(fragment);

  if (!segs) return undefined;
  let node: Node | undefined = file.root;

  for (const seg of segs) {
    if (isMap(node)) {
      const hit = mapIndex(node).get(seg)?.value as Node | null | undefined;

      node = hit ?? undefined;
    } else if (isSeq(node)) {
      const item: unknown = node.items[Number(seg)];

      node = (item as Node | undefined) ?? undefined;
    } else {
      return undefined;
    }
  }

  return node;
}

export class Expander {
  private readonly jsonFiles = new Map<string, JsonFile>();

  constructor(
    private readonly store: FileStore,
    private readonly rep: Reporter,
    private readonly budget: LoadBudget,
  ) {}

  /**
   * Expands a whole file as one layer, its scalars typed from `root` (by default, the root schema
   * of the layer's kind).
   */
  expandLayer<L extends FileLayerId>(
    file: ParsedFile,
    layer: L,
    root: Position | undefined = rootPosition(schemaKindOf(layer)),
  ): LayerBuild<L> {
    const build: LayerBuild<L> = {
      layer,
      parsed: file,
      tree: jsonObject(),
      locs: new Map(),
      uses: [],
      refs: new Map(),
      pendingRefs: [],
      sources: new Map(),
    };

    if (!file.root) return build;
    build.locs.set("", nodeSite(file, file.root));

    if (!isMap(file.root)) {
      this.rep.report({
        rule: "file-not-mapping",
        message: "the file does not hold a mapping at its top level",
        fix: "write the file as a mapping of keys",
        at: nodeSite(file, file.root),
      });

      return build;
    }

    const scope: Scope = {
      file,
      data: false,
      pos: root,
      parentKey: undefined,
      stack: [
        {
          key: `${this.store.realOf(file.path)}#`,
          shown: file.path,
          at: nodeSite(file, file.root),
        },
      ],
      depth: 0,
    };
    const value = this.node(build, file.root, "", scope);

    if (value !== null && typeof value === "object" && !Array.isArray(value)) build.tree = value;

    return build;
  }

  /**
   * Expands the schema files reached only through `$ref`, once the layer's names are known.
   * A file `$ref` is read as naming a schema: ADR 0002 section 2 shows it only for schema files
   * ("schema files are always name-keyed"), so the element joins `schemas`. Another catalogue
   * reached by file would need the expected catalogue from the authoring schema.
   */
  finishRefs(
    build: LayerBuild,
    visible: (
      name: string,
    ) => { site: SiteLocation | undefined; layer: string; source: string | undefined } | undefined,
  ): void {
    // A queue read by a cursor, fed by the refs each expansion adds: no rescan, no shift.
    const queue: FileRef[] = [];
    let next = 0;
    const queued = new Set<string>();
    const enqueueAll = () => {
      for (const r of build.pendingRefs.splice(0)) {
        if (!queued.has(r.id)) {
          queued.add(r.id);
          queue.push(r);
        }
      }
    };

    enqueueAll();
    const declared = (): JsonObject => {
      const existing = build.tree.schemas;

      if (existing !== undefined && typeof existing === "object" && !Array.isArray(existing)) {
        return existing as JsonObject;
      }

      const fresh = jsonObject();

      setKey(build.tree, "schemas", fresh);

      return fresh;
    };

    while (next < queue.length) {
      if (this.budget.exhausted) return;
      const ref = queue[next++] as FileRef;
      const pointer = `/schemas/${pointerEscape(ref.name)}`;
      const elementSite = pairSite(ref.file, ref.pair.key, ref.pair.value);
      const own = Object.hasOwn(asObject(build.tree.schemas) ?? {}, ref.name);
      const other = own
        ? {
            site: build.locs.get(pointer),
            layer: build.layer as string,
            source: build.sources.get(pointer),
          }
        : visible(ref.name);

      // The same element, already declared here or by a layer this one builds on (by an include
      // or another `$ref`): the `$ref` points at it.
      if (other?.source === ref.id) continue;

      if (other) {
        this.rep.report({
          rule: "declaration-twice",
          message: `schema '${ref.name}' is declared twice: by '${ref.file.path}' and by ${other.layer === build.layer ? "this layer" : `the layer '${other.layer}'`}`,
          fix: "remove the copy, or use the declared name instead of the file",
          at: elementSite,
          related: other.site ? [{ at: other.site, message: "also declared here" }] : [],
        });
        continue;
      }

      const before = build.uses.length;
      const scope: Scope = {
        file: ref.file,
        data: false,
        pos: positionAt(schemaKindOf(build.layer), ["schemas", ref.name]),
        parentKey: ref.name,
        stack: [
          {
            key: `${this.store.realOf(ref.file.path)}#/${pointerEscape(ref.name)}`,
            shown: `${ref.file.path}#/${pointerEscape(ref.name)}`,
            at: elementSite,
          },
        ],
        depth: 2,
      };
      const value = this.node(build, ref.pair.value, pointer, scope);

      setKey(declared(), ref.name, value);
      build.locs.set(pointer, elementSite);
      build.sources.set(pointer, ref.id);
      // What the element references in its own file comes along with it.
      const fileRoot = ref.file.root;

      for (const use of build.uses.slice(before)) {
        if (!isMap(fileRoot) || use.at.file !== ref.file.path) continue;
        const pair = mapIndex(fileRoot).get(use.name);

        if (pair) {
          const nid = `${this.store.realOf(ref.file.path)}#/${pointerEscape(use.name)}`;

          if (!queued.has(nid)) {
            queued.add(nid);
            queue.push({
              id: nid,
              name: use.name,
              file: ref.file,
              pair: { key: pair.key as Node, value: pair.value as Node | null },
              at: use.at,
            });
          }
        }
      }

      enqueueAll();
    }
  }

  /**
   * Charges a node (or a pair) written at `pointer` to the load's budget, and its depth against
   * the limit; false stops it.
   */
  private admit(file: ParsedFile, node: Node | null, depth: number, pointer: string): boolean {
    if (!this.budget.charge(loadWorkOf(pointer), () => nodeSite(file, node))) return false;

    if (depth > LOAD_MAX_DEPTH) {
      this.store.reportTooDeep(nodeSite(file, node));

      return false;
    }

    return true;
  }

  private node<L extends FileLayerId>(
    build: LayerBuild<L>,
    node: Node | null,
    pointer: string,
    scope: Scope,
  ): JsonValue {
    if (node === null || node === undefined || isAlias(node)) return null;

    if (!this.admit(scope.file, node, scope.depth, pointer)) return null;

    if (isScalar(node)) return this.scalar(node, scope);

    if (isSeq(node)) {
      const out: JsonValue[] = [];

      node.items.forEach((item, i) => {
        const child = `${pointer}/${i}`;
        const itemNode = item as Node | null;
        // An item is a position like a key's value: an item of a data list (`examples`) is data.
        const pos = scope.data ? undefined : stepPosition(scope.pos, String(i), true);

        out.push(
          this.node(build, itemNode, child, {
            ...scope,
            data: scope.data || (pos?.data ?? false),
            pos,
            parentKey: undefined,
            depth: scope.depth + 1,
          }),
        );
        build.locs.set(child, nodeSite(scope.file, itemNode));
      });

      return out;
    }

    if (isMap(node)) return this.map(build, node, pointer, scope);

    return null;
  }

  private scalar(node: Scalar, scope: Scope): JsonValue {
    const source = node.source ?? "";

    if (!scope.data && !node.tag) this.checkType(node, scope);

    if (scope.data && node.type === Scalar.PLAIN && !node.tag && NULL_SPELLINGS.has(source)) {
      this.rep.report({
        rule: "data-null",
        message: `null is written '${source}' here; in a data position it must be written null`,
        fix: "write null",
        at: nodeSite(scope.file, node),
      });
    }

    const value = node.value as JsonValue;

    if (typeof value === "string") {
      if (!this.budget.chargeText(value.length, () => nodeSite(scope.file, node))) return null;
    }

    return value;
  }

  /**
   * P6 (ADR 0002 section 3): a scalar whose YAML type is not one the authoring schema accepts
   * at this position, null included. The tag case is P9's, reported by the file walk.
   */
  private checkType(node: Scalar, scope: Scope): void {
    const type = scalarType(node.value);

    if (type === undefined || !scope.pos) return;

    if (!refusesScalar(scope.pos, type)) {
      this.checkQuotedInteger(node, scope.file, scope.pos);

      return;
    }

    // A plain scalar P1 to P4 refuse is reported once, by them: their fix (quote it) is the one.
    if (node.type === Scalar.PLAIN && loadScalarPitfall(node.source ?? "", node.value)) return;
    const expected = expectedTypes(scope.pos) ?? [];
    const written =
      node.type === Scalar.PLAIN ? (node.source ?? "") : JSON.stringify(String(node.value));
    const shown = diagnosticInert(written.length > 40 ? `${written.slice(0, 37)}...` : written);
    const wants = expected.join(" or ");
    const got =
      type === "null"
        ? "a null (no value, '~' or null)"
        : `'${shown}' is ${type === "integer" ? "an integer" : `a ${type}`}`;
    const quotable = expected.includes("a string") && type !== "null";

    this.rep.report({
      rule: "scalar-type",
      message: `${got} where the schema expects ${wants} (P6)`,
      fix: quotable ? `quote it ('${shown}') to write a string` : `write ${wants}`,
      at: nodeSite(scope.file, node),
    });
  }

  /**
   * P6, the ADR's own `version: '1'`: where a string or an integer goes, a quoted whole number in
   * plain decimal that the integer form takes is the integer, written as a string by mistake.
   */
  private checkQuotedInteger(node: Scalar, file: ParsedFile, pos: Position): void {
    if (node.type === Scalar.PLAIN || typeof node.value !== "string") return;

    if (!pos.types?.has("string") || !pos.types.has("integer")) return;

    if (!/^-?(0|[1-9][0-9]*)$/.test(node.value)) return;
    const n = Number(node.value);

    if (!Number.isSafeInteger(n) || !admitsInteger(pos, n)) return;
    const wants = (expectedTypes(pos) ?? []).join(" or ");

    this.rep.report({
      rule: "scalar-type",
      message: `'${JSON.stringify(node.value)}' is a quoted whole number where the schema expects ${wants}, and reads as the integer (P6)`,
      fix: `write ${node.value}, unquoted`,
      at: nodeSite(file, node),
    });
  }

  private map<L extends FileLayerId>(
    build: LayerBuild<L>,
    node: YAMLMap,
    pointer: string,
    scope: Scope,
  ): JsonValue {
    const fileKey = mapIndex(node).get("$file");

    if (fileKey) {
      if (node.items.length === 1) return this.fileDirective(build, fileKey, pointer, scope);

      if (!scope.data) {
        this.rep.report({
          rule: "directive-siblings",
          message: "$file replaces the value that holds it, so it cannot sit beside other keys",
          fix: "keep $file alone in its mapping",
          at: pairSite(scope.file, fileKey.key as Node, fileKey.value as Node | null),
        });

        return null;
      }
    }

    const out = jsonObject();

    this.items(build, node, pointer, scope, out, { sites: new Map(), order: [] });

    return out;
  }

  private items<L extends FileLayerId>(
    build: LayerBuild<L>,
    map: YAMLMap,
    pointer: string,
    scope: Scope,
    out: JsonObject,
    seen: MapKeys,
  ): void {
    const { file } = scope;
    let includeSite: SiteLocation | undefined;
    // Which conditional branches of the schema this mapping's keys decide (a node with `method` is
    // a route). Keys an include may bring are not seen here, so the view is open then.
    const index = mapIndex(map);
    const view: MapView = {
      has: (key) => index.has(key),
      scalar: (key) => {
        const value = index.get(key)?.value;

        return isScalar(value) ? value.value : NOT_SCALAR;
      },
      open: scope.stack.length > 1 || index.has("$include"),
    };
    const here = scope.data ? undefined : refinePosition(scope.pos, view);

    for (const pair of map.items) {
      // Every pair counts, `$include` ones too: a chain of includes builds nothing else.
      if (!this.admit(file, pair.key as Node, scope.depth, pointer)) return;
      const keyNode = pair.key as Node;
      const valueNode = pair.value as Node | null;
      const key = keyString(keyNode);

      if (key !== undefined && !this.budget.chargeText(key.length, () => nodeSite(file, keyNode))) {
        return;
      }

      if (key === undefined) {
        this.rep.report({
          rule: "key-not-scalar",
          message: "a mapping key must be a plain or quoted string",
          fix: "write the key as a string",
          at: nodeSite(file, keyNode),
        });
        continue;
      }

      if (isReservedKey(key)) {
        this.reserved(file, keyNode, key);
        continue;
      }

      if (key === "$include" && !scope.data) {
        // P7 holds for the directive too; `seen` cannot tell, as the included keys join it.
        const site = nodeSite(file, keyNode);

        if (includeSite) {
          this.rep.report({
            rule: "duplicate-key",
            message: "key '$include' is defined twice in the same mapping (P7)",
            fix: "write one $include with a list of paths",
            at: site,
            related: [{ at: includeSite, message: "first defined here" }],
          });
          continue;
        }

        includeSite = site;
        this.include(build, pair, pointer, scope, out, seen);
        continue;
      }

      const keySite = nodeSite(file, keyNode);
      const first = seen.sites.get(key);

      if (first) {
        this.rep.report({
          rule: "duplicate-key",
          message: `key '${key}' is defined twice in the same mapping (P7)`,
          fix: "remove the duplicate",
          at: keySite,
          related: [{ at: first, message: "first defined here" }],
        });
        continue;
      }

      seen.sites.set(key, keySite);
      seen.order.push(key);
      const child = `${pointer}/${pointerEscape(key)}`;
      const pos = scope.data ? undefined : stepPosition(here, key, false);
      let value = this.node(build, valueNode, child, {
        ...scope,
        data: scope.data || (pos?.data ?? false),
        pos,
        parentKey: key,
        depth: scope.depth + 1,
      });

      if (key === "$ref" && !scope.data && typeof value === "string") {
        value = this.ref(build, value, valueNode, child, scope);
      }

      setKey(out, key, value);
      build.locs.set(child, pairSite(file, keyNode, valueNode));
    }
  }

  private include<L extends FileLayerId>(
    build: LayerBuild<L>,
    pair: YAMLMap["items"][number],
    pointer: string,
    scope: Scope,
    out: JsonObject,
    seen: MapKeys,
  ): void {
    const { file } = scope;
    const valueNode = pair.value as Node | null;
    const site = pairSite(file, pair.key as Node, valueNode);

    if (scope.parentKey === "routes") {
      this.rep.report({
        rule: "include-under-routes",
        message: "$include cannot be a key of a mapping of named tree nodes (routes)",
        fix: "include the content inside a route, or write the route inline",
        at: site,
      });

      return;
    }

    const items = (isSeq(valueNode) ? valueNode.items : [valueNode]) as (Node | null)[];

    for (const item of items) {
      // Each target is charged before anything is resolved, an empty file or a bad item too.
      const raw = isScalar(item) && typeof item.value === "string" ? item.value : undefined;

      if (!this.budget.charge(loadWorkOf(raw ?? ""), () => nodeSite(file, item))) return;

      if (raw === undefined) {
        this.shape(file, item, "$include");
        continue;
      }

      const target = { raw, node: item as Node };
      const at = nodeSite(file, target.node);

      if (scope.stack.length >= LOAD_MAX_DEPTH) {
        this.store.reportTooDeep(at);

        return;
      }

      const resolved = this.store.resolve(file, target.raw, at, "include");

      if (!resolved) continue;
      const pf = this.store.parse(resolved.path, file.boundary);

      if (!pf?.root) continue;
      const mapNode = navigate(pf, resolved.fragment);

      if (mapNode === undefined) {
        this.rep.report({
          rule: "include-fragment",
          message: `the pointer '#${resolved.fragment}' of '${target.raw}' matches nothing in '${resolved.path}'`,
          fix: "point at an existing mapping, as in ./file.yaml#/Name",
          at,
        });
        continue;
      }

      if (!isMap(mapNode)) {
        this.rep.report({
          rule: "include-shape",
          message: `'${target.raw}' does not hold a mapping, and $include merges a mapping`,
          fix: "include a file or pointer that holds a mapping",
          at,
        });
        continue;
      }

      // Keyed on the real path: a directory link back into the tree is the same file.
      const key = `${resolved.real}#${resolved.fragment ?? ""}`;
      const shown = shownTarget(resolved.path, resolved.fragment);
      const at0 = scope.stack.findIndex((s) => s.key === key);

      if (at0 >= 0) {
        const cycle = scope.stack.slice(at0);
        const names = [...cycle.map((s) => s.shown), shown];

        this.rep.report({
          rule: "include-cycle",
          message: `$include cycle (P8): ${names.join(" -> ")}`,
          fix: "break the cycle by removing one $include of it",
          at,
          related: cycle.slice(1).map((s) => ({
            at: s.at,
            message: `'${s.shown}' is included here`,
          })),
        });
        continue;
      }

      const start = seen.order.length;
      const inner: Scope = {
        file: pf,
        data: false,
        pos: scope.pos,
        parentKey: scope.parentKey,
        stack: [...scope.stack, { key, shown, at }],
        depth: scope.depth,
      };

      this.items(build, mapNode, pointer, inner, out, seen);

      if (pointer === "/schemas") {
        // A nested include recorded its own keys first; those of this file are the rest.
        const prefix = `${resolved.real}#${resolved.fragment ?? ""}`;

        for (const k of seen.order.slice(start)) {
          const declaredAt = `/schemas/${pointerEscape(k)}`;

          if (!build.sources.has(declaredAt)) {
            build.sources.set(declaredAt, `${prefix}/${pointerEscape(k)}`);
          }
        }
      }
    }
  }

  private reserved(file: ParsedFile, node: Node | null, key: string): void {
    this.rep.report({
      rule: "reserved-key",
      message: `'${key}' cannot be a key: it names a property every JavaScript object inherits`,
      fix: "rename the key",
      at: nodeSite(file, node),
    });
  }

  private shape(file: ParsedFile, node: Node | null, what: string): void {
    this.rep.report({
      rule: "include-shape",
      message: `${what} takes a path, or a list of paths`,
      fix: `write ${what}: ./file.yaml or a list of paths`,
      at: nodeSite(file, node),
    });
  }

  private fileDirective<L extends FileLayerId>(
    build: LayerBuild<L>,
    pair: YAMLMap["items"][number],
    pointer: string,
    scope: Scope,
  ): JsonValue {
    const { file } = scope;
    const valueNode = pair.value as Node | null;
    const at = pairSite(file, pair.key as Node, valueNode);

    if (!isScalar(valueNode) || typeof valueNode.value !== "string") {
      this.rep.report({
        rule: "directive-value",
        message: "$file takes a path",
        fix: "write $file: ./docs/text.md",
        at,
      });

      return null;
    }

    const valueSite = nodeSite(file, valueNode);

    // Each site is charged before anything is resolved, and what it reads is charged per use.
    if (!this.budget.charge(loadWorkOf(valueNode.value), valueSite)) return null;

    if (scope.stack.length >= LOAD_MAX_DEPTH) {
      this.store.reportTooDeep(valueSite);

      return null;
    }

    const resolved = this.store.resolve(file, valueNode.value, valueSite, "file");

    if (!resolved) return null;
    const ext = resolved.path.slice(resolved.path.lastIndexOf(".") + 1).toLowerCase();

    if (ext === "md" || ext === "txt") {
      const text = this.store.rawText(resolved.path);

      if (text === undefined || !this.budget.chargeText(text.length, valueSite)) return null;

      return text;
    }

    if (ext === "json") {
      const json = this.jsonFile(resolved.path, resolved.real, valueSite);

      if (!json.ok) {
        this.rep.report({
          rule: "file-invalid",
          message: `'${resolved.path}' is not valid JSON: ${json.error}`,
          fix: "fix the JSON, or use a .yaml file",
          at: valueSite,
        });

        return null;
      }

      if (scope.depth + json.depth > LOAD_MAX_DEPTH) {
        this.store.reportTooDeep(valueSite);

        return null;
      }

      if (!this.budget.charge(json.nodes, valueSite)) return null;

      if (!this.budget.chargeText(json.text, valueSite)) return null;

      // Each use is its own copy: a layer tree never shares a node between two positions.
      return cloneJson(json.value);
    }

    if (ext === "yaml" || ext === "yml") {
      const pf = this.store.parse(resolved.path, file.boundary);

      if (!pf?.root) return null;
      const key = `${resolved.real}#`;
      const at0 = scope.stack.findIndex((s) => s.key === key);

      if (at0 >= 0) {
        const names = [...scope.stack.slice(at0).map((s) => s.shown), resolved.path];

        this.rep.report({
          rule: "include-cycle",
          message: `$file cycle (P8): ${names.join(" -> ")}`,
          fix: "break the cycle by removing one $file or $include of it",
          at: nodeSite(file, valueNode),
        });

        return null;
      }

      return this.node(build, pf.root, pointer, {
        file: pf,
        data: true,
        pos: undefined,
        parentKey: undefined,
        stack: [...scope.stack, { key, shown: resolved.path, at: nodeSite(file, valueNode) }],
        depth: scope.depth,
      });
    }

    this.rep.report({
      rule: "file-extension",
      message: `$file reads .md, .txt, .json and .yaml files, not '${resolved.path}'`,
      fix: "use one of those extensions",
      at: nodeSite(file, valueNode),
    });

    return null;
  }

  /**
   * A JSON file parsed once per real path and turned into the loader's own tree (no prototype,
   * no reserved key, reported at the first site that reads it), with what one use costs: its
   * nodes, its characters and its depth. Nothing deeper than the depth limit is walked.
   */
  private jsonFile(path: string, real: string, at: SiteLocation): JsonFile {
    const hit = this.jsonFiles.get(real);

    if (hit) return hit;
    let parsed: JsonValue;
    let result: JsonFile;

    try {
      parsed = JSON.parse(this.store.rawText(path) ?? "") as JsonValue;
      const cost = { nodes: 0, text: 0, depth: 0 };
      const value = this.jsonSafe(parsed, path, at, 0, cost);

      result = { ok: true, value, ...cost };
    } catch (e) {
      result = { ok: false, error: (e as Error).message };
    }

    this.jsonFiles.set(real, result);

    return result;
  }

  private jsonSafe(
    value: JsonValue,
    path: string,
    at: SiteLocation,
    depth: number,
    cost: { nodes: number; text: number; depth: number },
  ): JsonValue {
    cost.nodes++;

    if (depth > cost.depth) cost.depth = depth;

    if (depth > LOAD_MAX_DEPTH) return null; // refused per use, by depth

    if (typeof value === "string") cost.text += value.length;

    if (Array.isArray(value)) return value.map((v) => this.jsonSafe(v, path, at, depth + 1, cost));
    const obj = asObject(value);

    if (!obj) return value;
    const out = jsonObject();

    for (const [k, v] of Object.entries(obj)) {
      if (isReservedKey(k)) {
        this.rep.report({
          rule: "reserved-key",
          message: `'${path}' holds the key '${k}', which names a property every JavaScript object inherits`,
          fix: "rename the key in the JSON file",
          at,
        });
        continue;
      }

      cost.text += k.length;
      setKey(out, k, this.jsonSafe(v, path, at, depth + 1, cost));
    }

    return out;
  }

  private ref<L extends FileLayerId>(
    build: LayerBuild<L>,
    value: string,
    valueNode: Node | null,
    pointer: string,
    scope: Scope,
  ): string {
    const { file } = scope;
    const at = nodeSite(file, valueNode);

    if (value.startsWith("#")) {
      this.rep.report({
        rule: "ref-pointer",
        message: `a pointer into the merged catalogues ('${value}') is refused; the name says the same thing`,
        fix: "write the name: $ref: Task",
        at,
      });

      return value;
    }

    const isPath = value.includes("/") || value.includes("\\") || /^[A-Za-z]:/.test(value);

    if (!isPath) {
      build.uses.push({ name: value, at, pointer });

      return value;
    }

    const resolved = this.store.resolve(file, value, at, "ref");

    if (!resolved) return value;
    const pf = this.store.parse(resolved.path, file.boundary);

    if (!pf?.root) return value;

    if (!isMap(pf.root)) {
      this.rep.report({
        rule: "ref-file-shape",
        message: `'${value}' does not hold a mapping of names to schemas`,
        fix: "write the file as Name: { ...schema }",
        at,
      });

      return value;
    }

    let name: string | undefined;

    if (resolved.fragment !== undefined && resolved.fragment !== "") {
      const segs = pointerSegments(resolved.fragment);

      if (segs?.length !== 1) {
        this.rep.report({
          rule: "ref-fragment",
          message: `the pointer '#${resolved.fragment}' of $ref must name one element of the file`,
          fix: "point at one element, as in $ref: ./schemas/task.yaml#/Task",
          at,
        });

        return value;
      }

      name = segs[0];
    } else if (pf.root.items.length === 1) {
      name = keyString(pf.root.items[0]?.key as Node);
    } else {
      this.rep.report({
        rule: "ref-file-shape",
        message: `'${resolved.path}' declares ${pf.root.items.length} elements, and a $ref without a pointer needs exactly one`,
        fix: "add the element's name: $ref: ./schemas/task.yaml#/Task",
        at,
      });

      return value;
    }

    if (name !== undefined && isReservedKey(name)) {
      this.reserved(file, valueNode, name);

      return value;
    }

    const element = name === undefined ? undefined : mapIndex(pf.root).get(name);

    if (name === undefined || !element) {
      this.rep.report({
        rule: "ref-fragment",
        message: `'${resolved.path}' declares no element '${name ?? ""}'`,
        fix: "point at an element the file declares",
        at,
      });

      return value;
    }

    const id = `${resolved.real}#/${pointerEscape(name)}`;

    if (!build.refs.has(id)) {
      const ref: FileRef = {
        id,
        name,
        file: pf,
        pair: { key: element.key as Node, value: element.value as Node | null },
        at,
      };

      build.refs.set(id, ref);
      build.pendingRefs.push(ref);
    }

    return name;
  }
}
