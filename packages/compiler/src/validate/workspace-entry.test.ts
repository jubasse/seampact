import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { diagnosticLocation, printDiagnostics } from "../diagnostics/print.js";
import { loadFsReader, loadWorkspace } from "../load/index.js";
import { loadMemoryReader } from "../load/reader.js";
import { validateWorkspace } from "./validate.js";

const ROOT = fileURLToPath(new URL("../../../../fixtures/reference", import.meta.url));

function entryOf(files: Record<string, string>) {
  const loaded = loadWorkspace({ reader: loadMemoryReader(files), entry: "workspace.yaml" });
  const validated = validateWorkspace(loaded.workspace);
  return { loaded, validated };
}

test("reference contract loads and validates", () => {
  const loaded = loadWorkspace({ reader: loadFsReader(ROOT), entry: "workspace.yaml" });
  expect(loaded.diagnostics).toEqual([]);
  expect(loaded.workspace.entry?.layer).toBe("workspace");
  expect(loaded.workspace.entry?.file).toBe("workspace.yaml");
  const validated = validateWorkspace(loaded.workspace);
  expect(validated.workspace).toEqual([]);
  expect(validated.apis.map((a) => [a.api, a.diagnostics])).toEqual([
    ["tasks", []],
    ["tasksService", []],
  ]);
});

test("a typo in workspace.yaml is located at its file, line and column", () => {
  const { loaded, validated } = entryOf({
    "workspace.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n  sharde: ./shared.yaml\n",
    "a.yaml": "api: { name: a, version: 1 }\n",
  });
  expect(loaded.diagnostics).toEqual([]);
  const [d, ...rest] = validated.workspace;
  expect(rest).toEqual([]);
  expect(d?.origin).toMatchObject({ layer: "workspace" });
  expect(d && diagnosticLocation(d.origin, loaded.workspace.locations)).toMatchObject({
    file: "workspace.yaml",
    line: 4,
    column: 3,
  });
  expect(printDiagnostics(validated.workspace, loaded.workspace.locations)).toMatch(
    /^workspace\.yaml:4:3: error seampact\/validate\/[a-z-]+: .*sharde.* Fix: .+$/,
  );
});

test("every diagnostic on workspace.yaml resolves through the workspace table", () => {
  const { loaded, validated } = entryOf({
    "workspace.yaml":
      "workspace:\n  apis: {}\n  editorSchemas: ''\n  imports:\n    x: { package: p }\n  shared:\n    - a\n",
    "a.yaml": "api: { name: a, version: 1 }\n",
  });
  expect(validated.workspace.length).toBeGreaterThan(1);
  for (const d of validated.workspace) {
    expect(diagnosticLocation(d.origin, loaded.workspace.locations).line).toBeGreaterThan(0);
  }
});

test("the entry table's keys are disjoint from the load sites and the api tables", () => {
  const { loaded } = entryOf({
    "workspace.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n",
    "a.yaml": "api: { name: a, version: 1 }\n",
  });
  const keys = Object.keys(loaded.workspace.locations).filter((k) => k.startsWith("workspace#"));
  expect(keys).toContain("workspace#/workspace/apis/a");
  expect(keys.some((k) => k.startsWith("workspace#/~load/"))).toBe(false);
  for (const api of loaded.workspace.apis) {
    expect(Object.keys(api.locations).some((k) => k.startsWith("workspace#"))).toBe(false);
  }
});

test("a single api file has no entry document", () => {
  const loaded = loadWorkspace({
    reader: loadMemoryReader({ "api.yaml": "api: { name: a, version: 1 }\n" }),
    entry: "api.yaml",
  });
  expect(loaded.workspace.entry).toBeUndefined();
  expect(validateWorkspace(loaded.workspace).workspace).toEqual([]);
});

test("a workspace key brought by $include is refused", () => {
  const loaded = loadWorkspace({
    reader: loadMemoryReader({
      "workspace.yaml": "$include: ./ws.yaml\n",
      "ws.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n",
      "a.yaml": "api: { name: a, version: 1 }\n",
    }),
    entry: "workspace.yaml",
  });
  expect(loaded.diagnostics.map((d) => d.rule)).toEqual(["seampact/load/workspace-shape"]);
});

test("a scalar of the wrong type in workspace.yaml is a P6 load error, located", () => {
  const loaded = loadWorkspace({
    reader: loadMemoryReader({
      "workspace.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n  editorSchemas: 12\n",
      "a.yaml": "api: { name: a, version: 1 }\n",
    }),
    entry: "workspace.yaml",
  });
  expect(loaded.diagnostics.map((d) => d.rule)).toEqual(["seampact/load/scalar-type"]);
  expect(printDiagnostics(loaded.diagnostics, loaded.workspace.locations)).toMatch(
    /^workspace\.yaml:4:18: /,
  );
});
