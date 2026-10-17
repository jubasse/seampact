import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { diagnosticLocation, printDiagnostics } from "../diagnostics/print.js";
import { loadFsReader, loadWorkspace } from "../load/index.js";
import { loadMemoryReader } from "../load/reader.js";
import { entryLocationKey } from "../raw-tree.js";
import { validateWorkspace } from "./validate.js";

const ROOT = fileURLToPath(new URL("../../../../../fixtures/reference", import.meta.url));

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

test("the entry's keys are spelled by entryLocationKey", () => {
  const { loaded, validated } = entryOf({
    "workspace.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n  sharde: x\n",
    "a.yaml": "api: { name: a, version: 1 }\n",
  });

  expect(entryLocationKey("/workspace/apis/a")).toBe("workspace#/workspace/apis/a");
  expect(loaded.workspace.locations[entryLocationKey("/workspace/apis/a")]).toMatchObject({
    file: "workspace.yaml",
    line: 3,
  });
  const d = validated.workspace[0];

  expect(d && loaded.workspace.locations[entryLocationKey(d.origin.pointer)]).toBeDefined();
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

// ADR 0002 section 2: `$include` may bring any key, `workspace:` included; the entry's kind is
// read from its keys once its includes are resolved.
test("a workspace key brought by $include makes the entry a workspace", () => {
  const { loaded, validated } = entryOf({
    "workspace.yaml": "$include: ./ws.yaml\n",
    "ws.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n",
    "a.yaml": "api: { name: a, version: 1 }\n",
  });

  expect(loaded.diagnostics).toEqual([]);
  expect(loaded.workspace.entry?.layer).toBe("workspace");
  expect(loaded.workspace.apis.map((a) => a.name)).toEqual(["a"]);
  expect(validated.workspace).toEqual([]);
  expect(loaded.workspace.locations["workspace#/workspace/apis/a"]).toMatchObject({
    file: "ws.yaml",
    line: 3,
  });
});

test("an included workspace's scalars are typed as the workspace's, with its layer", () => {
  const { loaded } = entryOf({
    "workspace.yaml": "$include: ./ws.yaml\n",
    "ws.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n  editorSchemas: 12\n",
    "a.yaml": "api: { name: a, version: 1 }\n",
  });

  expect(loaded.diagnostics.map((d) => [d.rule, d.origin.layer])).toEqual([
    ["seampact/load/scalar-type", "workspace"],
  ]);
  expect(printDiagnostics(loaded.diagnostics, loaded.workspace.locations)).toMatch(
    /^ws\.yaml:4:18: /,
  );
});

test("an entry whose include brings api: is an api file, its diagnostics the api's", () => {
  const loaded = loadWorkspace({
    reader: loadMemoryReader({
      "api.yaml": "$include: ./head.yaml\n",
      "head.yaml": "api: { name: a, version: 1, summary: 12 }\n",
    }),
    entry: "api.yaml",
  });

  expect(loaded.workspace.entry).toBeUndefined();
  expect(loaded.workspace.apis.map((a) => a.name)).toEqual(["a"]);
  expect(loaded.diagnostics.map((d) => [d.rule, d.origin.layer])).toEqual([
    ["seampact/load/scalar-type", "api"],
  ]);
  const keys = Object.keys(loaded.workspace.locations);

  expect(keys.every((k) => !k.startsWith("workspace#"))).toBe(true);
});

test("an entry that is both a workspace and an api is refused", () => {
  const { loaded } = entryOf({
    "workspace.yaml": "api: { name: a, version: 1 }\n$include: ./ws.yaml\n",
    "ws.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n",
    "a.yaml": "api: { name: a, version: 1 }\n",
  });

  expect(loaded.diagnostics.map((d) => d.rule)).toEqual(["seampact/load/workspace-shape"]);
  expect(loaded.diagnostics[0]?.message).toContain("both");
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

test("an access written through $include is checked after resolution, through the real loader", () => {
  const loaded = loadWorkspace({
    reader: loadMemoryReader({
      "api.yaml":
        "api: { name: a, version: 1 }\nsurfaces:\n  app:\n    identity: user\n    routes:\n      health:\n        method: get\n        access: { $include: ./access.yaml }\n",
      "access.yaml": "public: ''\n",
    }),
    entry: "api.yaml",
  });

  expect(loaded.diagnostics).toEqual([]);
  const found = validateWorkspace(loaded.workspace).apis.flatMap((a) => a.diagnostics);

  expect(found.length).toBeGreaterThan(0);
  expect(found.map((d) => d.origin.pointer)).toContain("/surfaces/app/routes/health/access/public");
});

// The layer of a load diagnostic is the layer being loaded: a diagnostic on workspace.yaml raised
// after its expansion is the workspace's, and its key, `workspace#/~load/...`, meets no pointer of
// the entry document (none starts `/~load/`).
test("a load diagnostic on workspace.yaml has the workspace layer, its key disjoint from the entry's", () => {
  const { loaded } = entryOf({
    "workspace.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n    b: [x]\n",
    "a.yaml": "api: { name: a, version: 1 }\n",
  });
  const [d, ...rest] = loaded.diagnostics;

  expect(rest).toEqual([]);
  expect(d?.rule).toBe("seampact/load/workspace-shape");
  expect(d?.origin.layer).toBe("workspace");
  expect(d?.origin.pointer.startsWith("/~load/")).toBe(true);
  expect(d && diagnosticLocation(d.origin, loaded.workspace.locations)).toMatchObject({
    file: "workspace.yaml",
    line: 4,
  });
  const entryKeys = Object.keys(loaded.workspace.locations).filter(
    (k) => k.startsWith("workspace#") && !k.startsWith("workspace#/~load/"),
  );

  expect(entryKeys).toContain("workspace#/workspace/apis/b");
  expect(entryKeys).not.toContain(`workspace#${d?.origin.pointer}`);
});

test("a workspace that maps no api is reported with the workspace layer", () => {
  const { loaded } = entryOf({ "workspace.yaml": "workspace:\n  apis: {}\n" });

  expect(loaded.diagnostics.map((d) => [d.rule, d.origin.layer])).toEqual([
    ["seampact/load/workspace-shape", "workspace"],
  ]);
});

test("a scalar workspace key gets its P6 report only, not a 'neither' report", () => {
  const { loaded } = entryOf({ "workspace.yaml": "workspace: 12\n" });

  expect(loaded.diagnostics.map((d) => d.rule)).toEqual(["seampact/load/scalar-type"]);
});
