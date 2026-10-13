import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";

// The registry imports every stage module, and the orchestrator imports the registry. A stage module that
// imported the pipeline barrel would close a cycle, so stage modules import the seam barrel only (`seam.ts`).

const SRC = fileURLToPath(new URL("..", import.meta.url));

// Each stage module the registry imports, with the export it reads and a loader (a static import specifier).
const STAGES: readonly (readonly [string, string, () => Promise<Record<string, unknown>>])[] = [
  [
    "passes/tree/schemas/pass.ts",
    "treeSchemasPass",
    () => import("../passes/tree/schemas/pass.js"),
  ],
  ["passes/tree/nodes/pass.ts", "treeNodesPass", () => import("../passes/tree/nodes/pass.js")],
  [
    "passes/access/identity/pass.ts",
    "accessIdentityPass",
    () => import("../passes/access/identity/pass.js"),
  ],
  [
    "passes/access/rights/pass.ts",
    "accessRightsPass",
    () => import("../passes/access/rights/pass.js"),
  ],
  ["passes/derive/wire/pass.ts", "deriveWirePass", () => import("../passes/derive/wire/pass.js")],
  [
    "passes/derive/errors/pass.ts",
    "deriveErrorsPass",
    () => import("../passes/derive/errors/pass.js"),
  ],
  ["passes/link/pass.ts", "linkPass", () => import("../passes/link/pass.js")],
  ["finalize/finalize.ts", "finalizeIr", () => import("../finalize/finalize.js")],
  ["workspace/order.ts", "workspaceRelayOrder", () => import("../workspace/order.js")],
];

// The relative specifiers a module imports or re-exports at run time (`import type` and `export type` are erased).
function valueImports(file: string): string[] {
  const text = readFileSync(join(SRC, file), "utf8");
  const specifiers: string[] = [];
  for (const match of text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"(\.[^"]+)"/gms))
    if (match[1] !== undefined) specifiers.push(match[1]);
  return specifiers;
}

const resolve = (from: string, specifier: string): string =>
  relative(SRC, join(SRC, dirname(from), specifier)).replace(/\.js$/, ".ts");

// Every module `file` reaches through run-time imports, itself included.
function reach(file: string): Set<string> {
  const seen = new Set<string>();
  const visit = (at: string): void => {
    if (seen.has(at)) return;
    seen.add(at);
    for (const specifier of valueImports(at)) visit(resolve(at, specifier));
  };
  visit(file);
  return seen;
}

describe("the seam barrel keeps stage modules out of an import cycle", () => {
  test("the seam reaches neither the orchestrator, the registry nor any stage", () => {
    const reached = [...reach("pipeline/seam.ts")];
    expect(reached).toContain("pipeline/guard.ts");
    const outside = reached.filter(
      (file) =>
        file === "pipeline/index.ts" ||
        file === "pipeline/orchestrator.ts" ||
        file === "pipeline/registry.ts" ||
        /^(passes|finalize|workspace)\//.test(file),
    );
    expect(outside).toEqual([]);
  });

  test.each(STAGES)("%s imports the pipeline through the seam only", (file) => {
    const text = readFileSync(join(SRC, file), "utf8");
    const pipeline = [...text.matchAll(/from\s+"([^"]*pipeline\/[^"]*)"/g)].map((m) => m[1]);
    expect(pipeline.length).toBeGreaterThan(0);
    for (const specifier of pipeline) expect(specifier).toMatch(/\/pipeline\/seam\.js$/);
    expect(text).toContain("`pipeline/seam.js` only");
  });

  // A fresh module graph each time, entered first by the module named, read by a value import.
  test.each(STAGES)("%s loads first in a fresh module graph", async (_file, name, load) => {
    vi.resetModules();
    const stage = await load();
    expect(stage[name]).toBeDefined();
    const pipeline = await import("./index.js");
    const parts = pipeline.pipelineDefaultParts();
    expect([
      ...Object.values(parts.passes),
      parts.link,
      parts.relayOrder,
      parts.finalize,
    ]).toContain(stage[name]);
  });

  test("the package index loads first in a fresh module graph", async () => {
    vi.resetModules();
    const index = await import("../index.js");
    const parts = index.pipelineDefaultParts();
    expect(parts.passes["tree.schemas"]).toBe(index.treeSchemasPass);
    expect(parts.link).toBe(index.linkPass);
    expect(parts.finalize).toBe(index.finalizeIr);
    expect(typeof index.compileWorkspace).toBe("function");
  });
});
