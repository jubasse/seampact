import type { Origin } from "@seampact/spec/ir";
import type { ApiLayerId, JsonObject, JsonValue } from "../raw-tree.js";
import { type LoadBudget, loadWorkOf } from "./budget.js";
import type { LayerBuild } from "./expand.js";
import { asObject, jsonObject, ownValue, setKey } from "./json.js";
import { pointerEscape } from "./paths.js";
import type { Reporter, SiteLocation } from "./report.js";
import { nodeSite } from "./source.js";

// ADR 0002 section 2, Layers and overrides.

// Declarations are never overridden: one name declared by two layers is an error.
const DECLARATIONS = new Set([
  "schemas",
  "enums",
  "scalars",
  "errors",
  "natures",
  "schemes",
  "headers",
  "identities",
  "rights",
  "rules",
  "requirements",
  "scopes",
  "buckets",
  "services",
  "pagings",
  "formats",
]);
// Keys that direct the loader and are not part of what the layers declare.
const DIRECTIVES = new Set(["extends", "packs", "pack", "workspace"]);
// Maps of named entries merge per entry, each entry being a leaf.
const LEAF_MAPS = new Set(["/conventions/cache/families", "/conventions/errors/derived"]);
// `errors.every` is a union of every layer's list.
const UNIONS = new Set(["/conventions/errors/every"]);

export interface Merged {
  merged: JsonObject;
  leafOrigins: Record<string, Origin>;
}

/**
 * Merges an api's layers. Layers are built once and shared by the apis that build on them, so
 * this is where one layer's size is paid once per api: every node copied, every origin and
 * pointer written is charged to the load's budget, and the merge stops once it is spent.
 */
export function mergeLayers(layers: LayerBuild[], rep: Reporter, budget: LoadBudget): Merged {
  // Every value taken from a layer is copied: layers are cached and shared by the apis that build
  // on them, so a merge must never write into one.
  const merged = jsonObject();
  const winner = new Map<string, Origin>();
  // Per union pointer, the members already in the merged list (serialised).
  const unions = new Map<string, Set<string>>();
  const owners = new Map<
    string,
    { layer: string; file: string; at: SiteLocation; source: string | undefined }
  >();
  // A declaration is always reported: without its own position, at its layer file's top.
  const siteAt = (b: LayerBuild, ptr: string): SiteLocation =>
    b.locs.get(ptr) ?? b.locs.get("") ?? nodeSite(b.parsed, b.parsed.root);

  // Where the work being charged comes from, for the report when the budget runs out.
  let here: () => SiteLocation = () => siteAt(layers[layers.length - 1] as LayerBuild, "");
  const copy = (value: JsonValue): JsonValue => {
    if (!budget.charge(1, here)) return null;
    if (typeof value === "string" && !budget.chargeText(value.length, here)) return null;
    if (Array.isArray(value)) return value.map(copy);
    const obj = asObject(value);
    if (!obj) return value;
    const out = jsonObject();
    for (const [k, v] of Object.entries(obj)) {
      if (!budget.chargeText(k.length, here)) break;
      setKey(out, k, copy(v));
    }
    return out;
  };
  // The origins under a replaced value are those of its own nodes: walking the value it replaces
  // costs what writing that value cost, never a scan of every origin.
  const clear = (ptr: string, old: JsonValue | undefined) => {
    if (old === undefined || !budget.charge(loadWorkOf(ptr), here)) return;
    winner.delete(ptr);
    unions.delete(ptr);
    const obj = asObject(old);
    if (obj) {
      for (const [k, v] of Object.entries(obj)) clear(`${ptr}/${pointerEscape(k)}`, v);
    } else if (Array.isArray(old)) {
      for (const [i, v] of old.entries()) clear(`${ptr}/${i}`, v);
    }
  };
  const record = (value: JsonValue, mptr: string, layer: ApiLayerId, lptr: string) => {
    if (!budget.charge(loadWorkOf(mptr), here)) return;
    const obj = asObject(value);
    if (obj && Object.keys(obj).length > 0) {
      for (const [k, v] of Object.entries(obj)) {
        record(v, `${mptr}/${pointerEscape(k)}`, layer, `${lptr}/${pointerEscape(k)}`);
      }
    } else {
      winner.set(mptr, { layer, pointer: lptr });
    }
  };
  const declare = (
    b: LayerBuild,
    section: JsonObject,
    name: string,
    value: JsonValue,
    ptr: string,
    what: string,
  ) => {
    const owner = owners.get(ptr);
    const source = b.sources.get(ptr);
    if (owner) {
      // One file element reached by two layers (through `$ref` or `$include`) is one declaration.
      if (source !== undefined && owner.source === source) return;
      rep.report({
        rule: "declaration-twice",
        message: `'${name}' (${what}) is declared by both '${owner.layer}' (${owner.file}) and '${b.layer}' (${b.parsed.path}), and a declaration is never overridden, even when the two are identical`,
        fix: "remove the copy",
        at: siteAt(b, ptr),
        related: [{ at: owner.at, message: "first declared here" }],
      });
      return;
    }
    owners.set(ptr, { layer: b.layer, file: b.parsed.path, at: siteAt(b, ptr), source });
    setKey(section, name, copy(value));
    winner.set(ptr, { layer: b.layer, pointer: ptr });
    record(value, ptr, b.layer, ptr);
  };
  const ensure = (parent: JsonObject, key: string, ptr: string): JsonObject => {
    const old = ownValue(parent, key);
    const cur = asObject(old);
    if (cur) return cur;
    clear(ptr, old); // a setting written where a later layer declares
    const fresh = jsonObject();
    setKey(parent, key, fresh);
    return fresh;
  };

  const setting = (
    b: LayerBuild,
    parent: JsonObject,
    key: string,
    value: JsonValue,
    ptr: string,
    lptr: string,
  ) => {
    const cur = ownValue(parent, key);
    const curObj = asObject(cur);
    const valObj = asObject(value);
    if (cur === undefined) {
      setKey(parent, key, copy(value));
      record(value, ptr, b.layer, lptr);
    } else if (curObj && valObj) {
      // An empty mapping is a leaf: a later empty one wins it, a later filled one replaces it
      // by its own leaves.
      if (Object.keys(valObj).length === 0) {
        if (Object.keys(curObj).length === 0) winner.set(ptr, { layer: b.layer, pointer: lptr });
        return;
      }
      winner.delete(ptr);
      for (const [k, v] of Object.entries(valObj)) {
        if (budget.exhausted) return;
        const cptr = `${ptr}/${pointerEscape(k)}`;
        const lcptr = `${lptr}/${pointerEscape(k)}`;
        if (LEAF_MAPS.has(ptr)) {
          clear(cptr, ownValue(curObj, k));
          setKey(curObj, k, copy(v));
          winner.set(cptr, { layer: b.layer, pointer: lcptr });
        } else {
          setting(b, curObj, k, v, cptr, lcptr);
        }
      }
    } else if (UNIONS.has(ptr) && Array.isArray(cur) && Array.isArray(value)) {
      // `cur` is the merged copy, extended in place; the members seen so far are kept per union,
      // so each is serialised once per api. A list is a leaf: its one origin moves to this layer.
      let seen = unions.get(ptr);
      if (!seen) {
        seen = new Set();
        for (const x of cur) {
          const id = JSON.stringify(x);
          if (!budget.charge(loadWorkOf(id), here)) break;
          seen.add(id);
        }
        unions.set(ptr, seen);
      }
      for (const x of value) {
        const id = JSON.stringify(x);
        if (!budget.charge(loadWorkOf(id), here)) break;
        if (seen.has(id)) continue;
        seen.add(id);
        cur.push(copy(x));
      }
      winner.set(ptr, { layer: b.layer, pointer: lptr });
    } else {
      clear(ptr, cur);
      setKey(parent, key, copy(value));
      record(value, ptr, b.layer, lptr);
    }
  };

  for (const b of layers) {
    for (const [key, value] of Object.entries(b.tree)) {
      if (budget.exhausted) break;
      if (DIRECTIVES.has(key)) continue;
      const ptr = `/${pointerEscape(key)}`;
      here = () => siteAt(b, ptr);
      const section = asObject(value);
      if (DECLARATIONS.has(key) && section) {
        const target = ensure(merged, key, ptr);
        for (const [name, v] of Object.entries(section)) {
          if (budget.exhausted) break;
          declare(
            b,
            target,
            name,
            v,
            `${ptr}/${pointerEscape(name)}`,
            key === "formats" ? "format" : key,
          );
        }
      } else if (key === "extensions" && section) {
        const target = ensure(merged, key, ptr);
        for (const [prefix, pv] of Object.entries(section)) {
          if (budget.exhausted) break;
          const pptr = `${ptr}/${pointerEscape(prefix)}`;
          const keys = asObject(pv);
          if (keys) {
            const inner = ensure(target, prefix, pptr);
            for (const [name, v] of Object.entries(keys)) {
              if (budget.exhausted) break;
              declare(b, inner, name, v, `${pptr}/${pointerEscape(name)}`, `extension '${prefix}'`);
            }
          } else {
            declare(b, target, prefix, pv, pptr, "extension prefix");
          }
        }
      } else if (key === "derive" && Array.isArray(value)) {
        const existing = ownValue(merged, "derive");
        const target = Array.isArray(existing) ? existing : [];
        if (!Array.isArray(existing)) setKey(merged, "derive", target);
        value.forEach((entry, i) => {
          if (budget.exhausted) return;
          const name = asObject(entry)?.entry;
          const id = typeof name === "string" ? `/derive#${name}` : undefined;
          const owner = id ? owners.get(id) : undefined;
          const at = siteAt(b, `/derive/${i}`);
          if (id && owner) {
            // ADR 0002 section 2, clarified: an entry name is unique across every layer.
            const where =
              owner.layer !== b.layer
                ? `declared by both '${owner.layer}' (${owner.file}) and '${b.layer}' (${b.parsed.path})`
                : b.layer.startsWith("pack:")
                  ? `declared twice in the pack '${b.layer.slice("pack:".length)}'`
                  : `declared twice in '${b.parsed.path}'`;
            rep.report({
              rule: "declaration-twice",
              message: `derive entry '${String(name)}' is ${where}, and an entry name is unique across every layer`,
              fix:
                owner.layer === b.layer
                  ? "rename one of the two entries"
                  : "remove the copy, or rename one entry",
              at,
              related: [{ at: owner.at, message: "first declared here" }],
            });
            return;
          }
          if (id) owners.set(id, { layer: b.layer, file: b.parsed.path, at, source: undefined });
          const mptr = `/derive/${target.length}`;
          target.push(copy(entry));
          record(entry, mptr, b.layer, `/derive/${i}`);
        });
      } else {
        setting(b, merged, key, value, ptr, ptr);
      }
    }
  }

  // Emit in the merged tree's own order, so the record never depends on how it was built.
  const leafOrigins: Record<string, Origin> = {};
  here = () => siteAt(layers[layers.length - 1] as LayerBuild, "");
  const walk = (value: JsonValue, ptr: string) => {
    if (!budget.charge(loadWorkOf(ptr), here)) return;
    const o = winner.get(ptr);
    if (o) leafOrigins[ptr] = o;
    const obj = asObject(value);
    if (obj) {
      for (const [k, v] of Object.entries(obj)) walk(v, `${ptr}/${pointerEscape(k)}`);
    } else if (Array.isArray(value)) {
      for (const [i, v] of value.entries()) walk(v, `${ptr}/${i}`);
    }
  };
  walk(merged, "");
  return { merged, leafOrigins };
}
