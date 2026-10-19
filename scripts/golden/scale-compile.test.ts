import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type JsonObject, loadGoldenCompiler } from "./compiler.ts";
import { REPO_ROOT } from "./repo-root.ts";
import { SCALE_DIRECTORY } from "./scale.ts";
import { declaredSchemas } from "./scale-counts.ts";
import { scaleIrCounts } from "./scale-ir-counts.ts";

// CHK-001 to CHK-003 on the IR: the scale fixture compiles with no diagnostic and the IR holds the volumes of
// FR-18. The raw-tree counts are in scale.test.ts.

const compiler = await loadGoldenCompiler();
const scaleRoot = join(REPO_ROOT, SCALE_DIRECTORY);
const compiled = compiler.compile(scaleRoot, "workspace.yaml");
const loaded = compiler.loadValidated(scaleRoot, "workspace.yaml");
const SCALAR_SHAPES = ["string", "integer", "number", "boolean", "array"];
const temporaryRoots: string[] = [];

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function irsOf(workspace: typeof compiled): Record<string, JsonObject> {
  return Object.fromEntries(
    workspace.apis.map((api) => [api.api, JSON.parse(api.files?.irText ?? "{}")]),
  );
}

const counts = scaleIrCounts(irsOf(compiled));

describe("scale fixture compiled", () => {
  it("compiles with no diagnostic", () => {
    expect(compiled.problems).toEqual([]);
    expect(compiled.apis.map((api) => [api.api, api.problems, api.files !== undefined])).toEqual([
      ["inventory", [], true],
      ["billing", [], true],
      ["notify", [], true],
    ]);
  });

  it("scale IR volumes", () => {
    expect(counts.operations).toEqual({ inventory: 93, billing: 90, notify: 13 });
    expect(counts.identities).toEqual({ inventory: 4, billing: 4, notify: 4 });
    expect(counts.schemes).toEqual({ inventory: 5, billing: 5, notify: 5 });
  });

  it("scale IR schemas and examples", () => {
    const declarations = declaredSchemas(loaded.apis);
    const inline = Object.entries(declarations).filter(
      ([name]) => !counts.declaredSchemas.has(name),
    );

    expect(counts.examples).toBe(119);
    expect(counts.declaredSchemas.size + inline.length).toBe(241);

    // What the IR keeps no schema for is what it keeps inline: scalars and arrays (docs/ir/05-schemas.md).
    for (const [name, declaration] of inline) {
      expect(SCALAR_SHAPES, name).toContain(declaration.type);
    }
  });

  it("scale IR error codes", () => {
    expect(counts.errorCodes).toBe(112);
    expect(counts.errorFamilies).toBe(11);
  });

  it("parses every example", () => {
    const root = mkdtempSync(join(tmpdir(), "golden-scale-"));

    temporaryRoots.push(root);
    cpSync(scaleRoot, root, { recursive: true });

    const file = join(root, "notify/api.yaml");
    const original = readFileSync(file, "utf8");
    const broken = original.replace("state: eur, kind: a", "state: not-a-currency, kind: a");

    expect(broken).not.toBe(original);
    writeFileSync(file, broken);

    const result = compiler.compile(root, "workspace.yaml");
    const problems = result.apis.flatMap((api) => api.problems);

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toMatch(/example/i);
  });
});
