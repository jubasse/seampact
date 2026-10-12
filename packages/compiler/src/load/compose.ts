import type { Origin } from "@seampact/spec/ir";
import type { JsonObject, JsonValue } from "../raw-tree.js";
import { asObject, type LayerBuild, setKey } from "./expand.js";
import { pointerEscape } from "./paths.js";
import type { Reporter } from "./report.js";

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

export function mergeLayers(layers: LayerBuild[], rep: Reporter): Merged {
  const merged: JsonObject = {};
  const winner = new Map<string, Origin>();
  const owners = new Map<string, { layer: string; file: string; at: ReturnType<typeof siteAt> }>();
  const siteAt = (b: LayerBuild, ptr: string) => b.locs.get(ptr);

  const clear = (ptr: string) => {
    for (const k of [...winner.keys()]) if (k === ptr || k.startsWith(`${ptr}/`)) winner.delete(k);
  };
  const record = (value: JsonValue, mptr: string, layer: Origin["layer"], lptr: string) => {
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
    if (owner) {
      const at = siteAt(b, ptr);
      if (at) {
        const first = owner.at;
        rep.report({
          rule: "declaration-twice",
          message: `'${name}' (${what}) is declared by both '${owner.layer}' (${owner.file}) and '${b.layer}' (${b.parsed.path}), and a declaration is never overridden, even when the two are identical`,
          fix: "remove the copy",
          at,
          related: first ? [{ at: first, message: "first declared here" }] : [],
        });
      }
      return;
    }
    owners.set(ptr, { layer: b.layer, file: b.parsed.path, at: siteAt(b, ptr) });
    setKey(section, name, value);
    winner.set(ptr, { layer: b.layer, pointer: ptr });
    record(value, ptr, b.layer, ptr);
  };
  const ensure = (parent: JsonObject, key: string): JsonObject => {
    const cur = asObject(parent[key]);
    if (cur) return cur;
    const fresh: JsonObject = {};
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
    const cur = Object.hasOwn(parent, key) ? parent[key] : undefined;
    const curObj = asObject(cur);
    const valObj = asObject(value);
    if (cur === undefined) {
      setKey(parent, key, value);
      record(value, ptr, b.layer, lptr);
    } else if (curObj && valObj) {
      for (const [k, v] of Object.entries(valObj)) {
        const cptr = `${ptr}/${pointerEscape(k)}`;
        const lcptr = `${lptr}/${pointerEscape(k)}`;
        if (LEAF_MAPS.has(ptr)) {
          setKey(curObj, k, v);
          clear(cptr);
          winner.set(cptr, { layer: b.layer, pointer: lcptr });
        } else {
          setting(b, curObj, k, v, cptr, lcptr);
        }
      }
    } else if (UNIONS.has(ptr) && Array.isArray(cur) && Array.isArray(value)) {
      const seen = new Set(cur.map((x) => JSON.stringify(x)));
      const union = [...cur];
      for (const x of value) if (!seen.has(JSON.stringify(x))) union.push(x);
      setKey(parent, key, union);
      clear(ptr);
      winner.set(ptr, { layer: b.layer, pointer: lptr });
    } else {
      setKey(parent, key, value);
      clear(ptr);
      record(value, ptr, b.layer, lptr);
    }
  };

  for (const b of layers) {
    for (const [key, value] of Object.entries(b.tree)) {
      if (DIRECTIVES.has(key)) continue;
      const ptr = `/${pointerEscape(key)}`;
      const section = asObject(value);
      if (DECLARATIONS.has(key) && section) {
        const target = ensure(merged, key);
        for (const [name, v] of Object.entries(section)) {
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
        const target = ensure(merged, key);
        for (const [prefix, pv] of Object.entries(section)) {
          const pptr = `${ptr}/${pointerEscape(prefix)}`;
          const keys = asObject(pv);
          if (keys) {
            const inner = ensure(target, prefix);
            for (const [name, v] of Object.entries(keys)) {
              declare(b, inner, name, v, `${pptr}/${pointerEscape(name)}`, `extension '${prefix}'`);
            }
          } else {
            declare(b, target, prefix, pv, pptr, "extension prefix");
          }
        }
      } else if (key === "derive" && Array.isArray(value)) {
        const target = Array.isArray(merged.derive) ? merged.derive : [];
        if (!Array.isArray(merged.derive)) setKey(merged, "derive", target);
        value.forEach((entry, i) => {
          const name = asObject(entry)?.entry;
          const id = typeof name === "string" ? `/derive#${name}` : undefined;
          const owner = id ? owners.get(id) : undefined;
          const at = siteAt(b, `/derive/${i}`);
          if (id && owner && at) {
            rep.report({
              rule: "declaration-twice",
              message: `derive entry '${String(name)}' is declared by both '${owner.layer}' (${owner.file}) and '${b.layer}' (${b.parsed.path}), and a declaration is never overridden`,
              fix: "remove the copy",
              at,
              related: owner.at ? [{ at: owner.at, message: "first declared here" }] : [],
            });
            return;
          }
          if (id) owners.set(id, { layer: b.layer, file: b.parsed.path, at });
          const mptr = `/derive/${target.length}`;
          target.push(entry);
          record(entry, mptr, b.layer, `/derive/${i}`);
        });
      } else {
        setting(b, merged, key, value, ptr, ptr);
      }
    }
  }

  // Emit in the merged tree's own order, so the record never depends on how it was built.
  const leafOrigins: Record<string, Origin> = {};
  const walk = (value: JsonValue, ptr: string) => {
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
