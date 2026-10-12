import type { Origin } from "@seampact/spec/ir";
import { isAlias, isMap, isScalar, isSeq, type Node, Scalar, type YAMLMap } from "yaml";
import type { JsonObject, JsonValue } from "../raw-tree.js";
import { pointerEscape, pointerSegments } from "./paths.js";
import type { Reporter, SiteLocation } from "./report.js";
import { type FileStore, nodeSite, pairSite, type ParsedFile } from "./source.js";

// ADR 0002 section 2: `$include`, `$file` and the file form of `$ref`, expanded over the YAML
// syntax tree so that every merged node keeps the position it was written at.

export interface RefUse {
  name: string;
  at: SiteLocation;
  pointer: string;
}

interface FileRef {
  name: string;
  file: ParsedFile;
  pair: { key: Node | null; value: Node | null };
  at: SiteLocation;
}

/** One layer file, expanded. `locs` maps a layer pointer to where it is written. */
export interface LayerBuild {
  layer: Origin["layer"];
  parsed: ParsedFile;
  tree: JsonObject;
  locs: Map<string, SiteLocation>;
  uses: RefUse[];
  refs: Map<string, FileRef>;
  /** `<file>#<name>` of every schema an `$include` under `schemas` declared. */
  included: Set<string>;
}

interface StackEntry {
  key: string;
  at: SiteLocation;
}

interface Scope {
  file: ParsedFile;
  data: boolean;
  parentKey: string | undefined;
  stack: StackEntry[];
}

// Data positions (ADR 0002 section 2): only a mapping whose sole key is `$file` is processed.
const DATA_KEYS = new Set(["value", "example", "examples", "default"]);
// Mappings whose keys are names an author chooses, so `default:` or `value:` there is a name.
// The loader has no grammar table; this is the known approximation (see the report).
const NAME_KEYED = new Set([
  "properties",
  "query",
  "pathParams",
  "headers",
  "params",
  "id",
  "fields",
]);

const NULL_SPELLINGS = new Set(["", "~", "Null", "NULL"]);

export function setKey(obj: JsonObject, key: string, value: JsonValue): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

export function asObject(v: JsonValue | undefined): JsonObject | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v : undefined;
}

export function keyString(node: Node | null | undefined): string | undefined {
  if (!isScalar(node)) return undefined;
  if (node.type === Scalar.PLAIN) return node.source ?? String(node.value);
  return String(node.value);
}

function displayStackKey(key: string): string {
  return key.endsWith("#") ? key.slice(0, -1) : key;
}

export function navigate(file: ParsedFile, fragment: string | undefined): Node | undefined {
  if (!file.root) return undefined;
  if (fragment === undefined || fragment === "") return file.root;
  const segs = pointerSegments(fragment);
  if (!segs) return undefined;
  let node: Node | undefined = file.root;
  for (const seg of segs) {
    if (isMap(node)) {
      const hit: Node | null | undefined = node.items.find((p) => keyString(p.key as Node) === seg)
        ?.value as Node | null | undefined;
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
  constructor(
    private readonly store: FileStore,
    private readonly rep: Reporter,
  ) {}

  /** Expands a whole file as one layer. */
  expandLayer(file: ParsedFile, layer: Origin["layer"]): LayerBuild {
    const build: LayerBuild = {
      layer,
      parsed: file,
      tree: {},
      locs: new Map(),
      uses: [],
      refs: new Map(),
      included: new Set(),
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
      parentKey: undefined,
      stack: [{ key: `${file.path}#`, at: nodeSite(file, file.root) }],
    };
    const value = this.node(build, file.root, "", scope);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) build.tree = value;
    return build;
  }

  /** Expands the schema files reached only through `$ref`, once the layer's names are known. */
  finishRefs(
    build: LayerBuild,
    visible: (name: string) => { site: SiteLocation | undefined; layer: string } | undefined,
  ): void {
    const queue: FileRef[] = [];
    const queued = new Set<string>();
    const enqueueAll = () => {
      for (const r of build.refs.values()) {
        const id = `${r.file.path}#${r.name}`;
        if (!queued.has(id)) {
          queued.add(id);
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
      const fresh: JsonObject = {};
      setKey(build.tree, "schemas", fresh);
      return fresh;
    };
    while (queue.length > 0) {
      const ref = queue.shift() as FileRef;
      const id = `${ref.file.path}#${ref.name}`;
      if (build.included.has(id)) continue; // declared once, by the include (ADR 0002 section 2)
      const elementSite = pairSite(ref.file, ref.pair.key, ref.pair.value);
      const own = Object.hasOwn(asObject(build.tree.schemas) ?? {}, ref.name);
      const other = own
        ? {
            site: build.locs.get(`/schemas/${pointerEscape(ref.name)}`),
            layer: build.layer as string,
          }
        : visible(ref.name);
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
      const pointer = `/schemas/${pointerEscape(ref.name)}`;
      const before = build.uses.length;
      const scope: Scope = {
        file: ref.file,
        data: false,
        parentKey: ref.name,
        stack: [{ key: `${ref.file.path}#/${pointerEscape(ref.name)}`, at: elementSite }],
      };
      const value = this.node(build, ref.pair.value, pointer, scope);
      setKey(declared(), ref.name, value);
      build.locs.set(pointer, elementSite);
      // What the element references in its own file comes along with it.
      const fileRoot = ref.file.root;
      for (const use of build.uses.slice(before)) {
        if (!isMap(fileRoot) || use.at.file !== ref.file.path) continue;
        const pair = fileRoot.items.find((p) => keyString(p.key as Node) === use.name);
        if (pair) {
          const nid = `${ref.file.path}#${use.name}`;
          if (!queued.has(nid)) {
            queued.add(nid);
            queue.push({
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

  private node(build: LayerBuild, node: Node | null, pointer: string, scope: Scope): JsonValue {
    if (node === null || node === undefined || isAlias(node)) return null;
    if (isScalar(node)) return this.scalar(node, scope);
    if (isSeq(node)) {
      const out: JsonValue[] = [];
      node.items.forEach((item, i) => {
        const child = `${pointer}/${i}`;
        const itemNode = item as Node | null;
        out.push(this.node(build, itemNode, child, { ...scope, parentKey: undefined }));
        build.locs.set(child, nodeSite(scope.file, itemNode));
      });
      return out;
    }
    if (isMap(node)) return this.map(build, node, pointer, scope);
    return null;
  }

  private scalar(node: Scalar, scope: Scope): JsonValue {
    const source = node.source ?? "";
    if (scope.data && node.type === Scalar.PLAIN && !node.tag && NULL_SPELLINGS.has(source)) {
      this.rep.report({
        rule: "data-null",
        message: `null is written '${source}' here; in a data position it must be written null`,
        fix: "write null",
        at: nodeSite(scope.file, node),
      });
    }
    return node.value as JsonValue;
  }

  private map(build: LayerBuild, node: YAMLMap, pointer: string, scope: Scope): JsonValue {
    const fileKey = node.items.find((p) => keyString(p.key as Node) === "$file");
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
    const out: JsonObject = {};
    this.items(build, node, pointer, scope, out, new Map());
    return out;
  }

  private items(
    build: LayerBuild,
    map: YAMLMap,
    pointer: string,
    scope: Scope,
    out: JsonObject,
    seen: Map<string, SiteLocation>,
  ): void {
    const { file } = scope;
    for (const pair of map.items) {
      const keyNode = pair.key as Node;
      const valueNode = pair.value as Node | null;
      const key = keyString(keyNode);
      if (key === undefined) {
        this.rep.report({
          rule: "key-not-scalar",
          message: "a mapping key must be a plain or quoted string",
          fix: "write the key as a string",
          at: nodeSite(file, keyNode),
        });
        continue;
      }
      if (key === "$include" && !scope.data) {
        this.include(build, pair, pointer, scope, out, seen);
        continue;
      }
      const keySite = nodeSite(file, keyNode);
      const first = seen.get(key);
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
      seen.set(key, keySite);
      const child = `${pointer}/${pointerEscape(key)}`;
      const data = scope.data || (DATA_KEYS.has(key) && !NAME_KEYED.has(scope.parentKey ?? ""));
      let value = this.node(build, valueNode, child, { ...scope, data, parentKey: key });
      if (key === "$ref" && !scope.data && typeof value === "string") {
        value = this.ref(build, value, valueNode, child, scope);
      }
      setKey(out, key, value);
      build.locs.set(child, pairSite(file, keyNode, valueNode));
    }
  }

  private include(
    build: LayerBuild,
    pair: YAMLMap["items"][number],
    pointer: string,
    scope: Scope,
    out: JsonObject,
    seen: Map<string, SiteLocation>,
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
    const targets: { raw: string; node: Node }[] = [];
    if (isScalar(valueNode) && typeof valueNode.value === "string") {
      targets.push({ raw: valueNode.value, node: valueNode });
    } else if (isSeq(valueNode)) {
      for (const item of valueNode.items) {
        if (isScalar(item) && typeof item.value === "string") {
          targets.push({ raw: item.value, node: item });
        } else {
          this.shape(file, item as Node | null, "$include");
        }
      }
    } else {
      this.shape(file, valueNode, "$include");
    }
    for (const target of targets) {
      const at = nodeSite(file, target.node);
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
      const key = `${resolved.path}#${resolved.fragment ?? ""}`;
      const at0 = scope.stack.findIndex((s) => s.key === key);
      if (at0 >= 0) {
        const cycle = scope.stack.slice(at0);
        const names = [...cycle.map((s) => displayStackKey(s.key)), displayStackKey(key)];
        this.rep.report({
          rule: "include-cycle",
          message: `$include cycle (P8): ${names.join(" -> ")}`,
          fix: "break the cycle by removing one $include of it",
          at,
          related: cycle.slice(1).map((s) => ({
            at: s.at,
            message: `'${displayStackKey(s.key)}' is included here`,
          })),
        });
        continue;
      }
      const before = new Set(Object.keys(out));
      const inner: Scope = {
        file: pf,
        data: false,
        parentKey: scope.parentKey,
        stack: [...scope.stack, { key, at }],
      };
      this.items(build, mapNode, pointer, inner, out, seen);
      if (pointer === "/schemas") {
        for (const k of Object.keys(out)) {
          if (!before.has(k)) build.included.add(`${pf.path}#${k}`);
        }
      }
    }
  }

  private shape(file: ParsedFile, node: Node | null, what: string): void {
    this.rep.report({
      rule: "include-shape",
      message: `${what} takes a path, or a list of paths`,
      fix: `write ${what}: ./file.yaml or a list of paths`,
      at: nodeSite(file, node),
    });
  }

  private fileDirective(
    build: LayerBuild,
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
    const resolved = this.store.resolve(file, valueNode.value, nodeSite(file, valueNode), "file");
    if (!resolved) return null;
    const ext = resolved.path.slice(resolved.path.lastIndexOf(".") + 1).toLowerCase();
    if (ext === "md" || ext === "txt") {
      return this.store.rawText(resolved.path) ?? null;
    }
    if (ext === "json") {
      const text = this.store.rawText(resolved.path) ?? "";
      try {
        return JSON.parse(text) as JsonValue;
      } catch (e) {
        this.rep.report({
          rule: "file-invalid",
          message: `'${resolved.path}' is not valid JSON: ${(e as Error).message}`,
          fix: "fix the JSON, or use a .yaml file",
          at: nodeSite(file, valueNode),
        });
        return null;
      }
    }
    if (ext === "yaml" || ext === "yml") {
      const pf = this.store.parse(resolved.path, file.boundary);
      if (!pf?.root) return null;
      const key = `${resolved.path}#`;
      const at0 = scope.stack.findIndex((s) => s.key === key);
      if (at0 >= 0) {
        const names = [...scope.stack.slice(at0).map((s) => displayStackKey(s.key)), resolved.path];
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
        parentKey: undefined,
        stack: [...scope.stack, { key, at: nodeSite(file, valueNode) }],
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

  private ref(
    build: LayerBuild,
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
    const element = pf.root.items.find((p) => keyString(p.key as Node) === name);
    if (name === undefined || !element) {
      this.rep.report({
        rule: "ref-fragment",
        message: `'${resolved.path}' declares no element '${name ?? ""}'`,
        fix: "point at an element the file declares",
        at,
      });
      return value;
    }
    const id = `${pf.path}#${name}`;
    if (!build.refs.has(id)) {
      build.refs.set(id, {
        name,
        file: pf,
        pair: { key: element.key as Node, value: element.value as Node | null },
        at,
      });
    }
    return name;
  }
}
