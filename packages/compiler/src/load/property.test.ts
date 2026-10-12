import { expect, test } from "vitest";
import { must } from "./golden.js";
import { loadMemoryReader, loadWorkspace } from "./index.js";

// CHK-109 at raw-tree level (ADR 0002, the byte-identity rule): random nodes of generated trees
// moved into `$include` files give the same merged tree, key order and origins as the inline
// form. Only the source map differs. A seeded generator keeps every run reproducible.

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Tree = { [key: string]: Tree | number | string | boolean | number[] };

const NAMES = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
  "iota",
  "kappa",
];

function genTree(r: () => number, depth: number): Tree {
  const count = 1 + Math.floor(r() * 5);
  const keys = [...NAMES].sort(() => r() - 0.5).slice(0, count);
  const out: Tree = {};
  for (const key of keys) {
    const pick = r();
    if (depth > 0 && pick < 0.45) out[key] = genTree(r, depth - 1);
    else if (pick < 0.65) out[key] = Math.floor(r() * 1000);
    else if (pick < 0.8) out[key] = `text ${Math.floor(r() * 100)}`;
    else if (pick < 0.9) out[key] = r() < 0.5;
    else out[key] = [Math.floor(r() * 9), Math.floor(r() * 9)];
  }
  return out;
}

interface Emitted {
  files: Record<string, string>;
  includes: number;
}

// Emits the tree as block YAML. With `external`, a contiguous slice of some mappings' entries
// (sometimes all of them) moves to its own file, and `$include` stands where the slice began.
function emitFiles(tree: Tree, r: () => number, external: boolean): Emitted {
  const files: Record<string, string> = {};
  let includes = 0;
  let counter = 0;

  const scalar = (v: unknown) => JSON.stringify(v);
  const entries = (map: Tree, indent: number, dir: string): string[] => {
    const keys = Object.keys(map);
    const lines: string[] = [];
    let slice: [number, number] | undefined;
    if (external && r() < 0.5) {
      const start = Math.floor(r() * keys.length);
      slice = [start, start + 1 + Math.floor(r() * (keys.length - start))];
    }
    const pad = " ".repeat(indent);
    keys.forEach((key, i) => {
      if (slice && i >= slice[0] && i < slice[1]) {
        if (i === slice[0]) {
          const name = `part${counter++}.yaml`;
          const moved: Tree = {};
          for (const k of keys.slice(slice[0], slice[1])) moved[k] = map[k] as Tree;
          // A file reached by a pointer holds its mapping under a name: the other way to include.
          const viaPointer = r() < 0.3;
          if (viaPointer) {
            files[`parts/${name}`] =
              `Fragment:\n${entries(moved, 2, "parts").join("\n")}\nOther: { x: 1 }\n`;
            lines.push(`${pad}$include: ${dir === "." ? "./parts/" : "./"}${name}#/Fragment`);
          } else {
            files[`parts/${name}`] = `${entries(moved, 0, "parts").join("\n")}\n`;
            lines.push(`${pad}$include: ${dir === "." ? "./parts/" : "./"}${name}`);
          }
          includes++;
        }
        return;
      }
      const value = map[key];
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        lines.push(`${pad}${key}:`, ...entries(value as Tree, indent + 2, dir));
      } else {
        lines.push(`${pad}${key}: ${scalar(value)}`);
      }
    });
    return lines;
  };
  const body = entries(tree, 4, ".");
  files["api.yaml"] = `api: { name: t }\nschemas:\n  S:\n${body.join("\n")}\n`;
  return { files, includes };
}

test("inline equals included", () => {
  let moved = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const tree = genTree(rng(seed), 3);
    const inline = emitFiles(tree, rng(seed + 1000), false);
    const split = emitFiles(tree, rng(seed + 1000), true);
    moved += split.includes;
    const a = loadWorkspace({ reader: loadMemoryReader(inline.files), entry: "api.yaml" });
    const b = loadWorkspace({ reader: loadMemoryReader(split.files), entry: "api.yaml" });
    expect(a.diagnostics, `seed ${seed} inline`).toEqual([]);
    expect(b.diagnostics, `seed ${seed} split`).toEqual([]);
    const apiA = a.workspace.apis[0];
    const apiB = b.workspace.apis[0];
    // Same tree, same key order (stringify keeps order), same origins in the same order.
    expect(JSON.stringify(apiB?.merged), `seed ${seed} merged`).toBe(JSON.stringify(apiA?.merged));
    expect(JSON.stringify(apiB?.leafOrigins), `seed ${seed} origins`).toBe(
      JSON.stringify(apiA?.leafOrigins),
    );
    expect(JSON.stringify((must(apiA).merged.schemas as { S: unknown }).S)).toBe(
      JSON.stringify(tree),
    );
    if (split.includes > 0) {
      // Only the source map differs.
      expect(JSON.stringify(b.workspace.locations)).not.toBe(JSON.stringify(a.workspace.locations));
    }
  }
  expect(moved).toBeGreaterThan(100);
});

test("a moved property keeps its position", () => {
  const inline = loadWorkspace({
    reader: loadMemoryReader({
      "api.yaml": "api: { name: t }\nschemas:\n  S:\n    a: 1\n    b: 2\n    c: 3\n    d: 4\n",
    }),
    entry: "api.yaml",
  });
  const moved = loadWorkspace({
    reader: loadMemoryReader({
      "api.yaml": "api: { name: t }\nschemas:\n  S:\n    a: 1\n    $include: ./bc.yaml\n    d: 4\n",
      "bc.yaml": "b: 2\nc: 3\n",
    }),
    entry: "api.yaml",
  });
  const keys = (r: typeof inline) =>
    Object.keys((must(r.workspace.apis[0]).merged.schemas as { S: object }).S);
  expect(keys(moved)).toEqual(["a", "b", "c", "d"]);
  expect(keys(moved)).toEqual(keys(inline));
});
