import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// The root and `/web` exports serve the Web-standard runtimes (Bun, Deno, Next.js, Workers): every module they reach
// imports no `node:` module but the one those runtimes provide, and no `node-` transport module.

const NODE_IMPORT = /(?:\bfrom|\bimport\s*\(?)\s*"(node:[^"]+)"/g;
const RELATIVE_IMPORT = /from "\.\/([^"]+)\.js"/g;
// The one Node module the Web-standard runtimes provide (Workers with `nodejs_als`).
const WEB_ALLOWED_NODE_IMPORTS = ["node:async_hooks"];
const WEB_ENTRY_MODULES = ["index", "web"];

function moduleSource(module: string): string {
  return readFileSync(new URL(`./${module}.ts`, import.meta.url), "utf8");
}

function importsOf(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}

// Every module the entry modules reach through relative imports, entries included.
function reachedModules(entries: readonly string[]): Set<string> {
  const reached = new Set<string>();
  const pending = [...entries];

  for (let module = pending.pop(); module !== undefined; module = pending.pop()) {
    if (reached.has(module)) continue;

    reached.add(module);
    pending.push(...importsOf(moduleSource(module), RELATIVE_IMPORT));
  }

  return reached;
}

describe("the Web-standard exports", () => {
  const reached = reachedModules(WEB_ENTRY_MODULES);

  test("reach no node- transport module", () => {
    expect([...reached].filter((module) => module.startsWith("node-"))).toEqual([]);
  });

  test("import no node: module but node:async_hooks", () => {
    const nodeImports = [...reached].flatMap((module) =>
      importsOf(moduleSource(module), NODE_IMPORT),
    );

    expect(nodeImports.filter((name) => !WEB_ALLOWED_NODE_IMPORTS.includes(name))).toEqual([]);
  });
});
