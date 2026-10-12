import { expect, test } from "vitest";
import { must } from "./golden.js";
import { diagnosticLocation, printDiagnostics } from "../diagnostics/print.js";
import { loadWorkspace } from "./index.js";
import { type LoadMemoryOptions, loadMemoryReader } from "./reader.js";

function run(files: Record<string, string>, entry = "api.yaml", options?: LoadMemoryOptions) {
  const result = loadWorkspace({ reader: loadMemoryReader(files, options), entry });
  const where = (d: (typeof result.diagnostics)[number]) =>
    diagnosticLocation(d.origin, result.workspace.locations);
  return {
    result,
    where,
    printed: printDiagnostics(result.diagnostics, result.workspace.locations),
  };
}
const rules = (r: ReturnType<typeof run>) =>
  r.result.diagnostics.map((d) => d.rule.replace("seampact/load/", ""));

test("extends conflict names both locations", () => {
  const r = run({
    "api.yaml":
      "api: { name: tasks }\nextends: ./base.yaml\nerrors:\n  api.forbidden: { status: 401 }\n",
    "base.yaml": "errors:\n  api.forbidden: { status: 403 }\n",
  });
  expect(r.result.diagnostics).toHaveLength(1);
  const d = must(r.result.diagnostics[0]);
  expect(d.rule).toBe("seampact/load/declaration-twice");
  expect(r.where(d)).toMatchObject({ file: "api.yaml", line: 4, column: 3 });
  expect(d.related).toHaveLength(1);
  expect(diagnosticLocation(must(d.related[0]).origin, r.result.workspace.locations)).toMatchObject(
    {
      file: "base.yaml",
      line: 2,
      column: 3,
    },
  );
  expect(d.fix).toBe("remove the copy");
});

test("extends conflict names both locations even when the two are identical", () => {
  const r = run({
    "api.yaml":
      "api: { name: tasks }\nextends: ./base.yaml\nerrors:\n  api.forbidden: { status: 403 }\n",
    "base.yaml": "errors:\n  api.forbidden: { status: 403 }\n",
  });
  expect(rules(r)).toEqual(["declaration-twice"]);
  expect(r.printed).toContain("Fix: remove the copy.");
  expect(r.printed).toContain("  base.yaml:2:3: first declared here.");
});

test("a base extends nothing, an api cannot extend itself", () => {
  const r = run({
    "api.yaml": "api: { name: tasks }\nextends: ./base.yaml\n",
    "base.yaml": "extends: ./other.yaml\n",
    "other.yaml": "errors: {}\n",
  });
  expect(rules(r)).toEqual(["base-extends"]);
  const self = run({ "api.yaml": "api: { name: tasks }\nextends: ./api.yaml\n" });
  expect(rules(self)).toEqual(["extends-cycle"]);
});

test("layer visibility", () => {
  const files = {
    "workspace.yaml": "workspace:\n  apis: { tasks: ./api.yaml }\n  shared: ./shared.yaml\n",
    "shared.yaml": "packs: [./packs/s.yaml]\nschemas:\n  Shared: { type: string }\n",
    "packs/s.yaml": "pack: { name: s, version: 1.0.0 }\nschemas:\n  FromPack: { type: string }\n",
    "api.yaml":
      "api: { name: tasks }\nextends: ./base.yaml\nschemas:\n  OnlyApi: { type: string }\n",
    "base.yaml":
      "schemas:\n  Uses:\n    properties:\n      a: { $ref: Shared }\n      b: { $ref: FromPack }\n      c: { $ref: OnlyApi }\n",
  };
  const r = run(files, "workspace.yaml");
  expect(rules(r)).toEqual(["name-not-visible"]);
  const d = must(r.result.diagnostics[0]);
  expect(d.message).toContain("'OnlyApi'");
  expect(d.fix).toBe("move the declaration into the shared file or the base");
  expect(r.where(d)).toMatchObject({ file: "base.yaml", line: 6 });
  expect(d.related[0]?.message).toBe("declared here");
  expect(r.result.workspace.apis[0]?.visibility).toEqual({
    "pack:s": ["pack:s"],
    shared: ["pack:s", "shared"],
    base: ["base", "pack:s", "shared"],
    api: ["api", "base", "pack:s", "shared"],
  });
});

test("layers are applied packs first, then shared, base, api; a pack reached twice once", () => {
  const files = {
    "workspace.yaml": "workspace:\n  apis: { tasks: ./api.yaml }\n  shared: ./shared.yaml\n",
    "shared.yaml": "packs: [./packs/b.yaml]\n",
    "packs/a.yaml": "pack: { name: a, version: 1.0.0 }\n",
    "packs/b.yaml": "pack: { name: b, version: 1.0.0, extends: [./a.yaml] }\n",
    "api.yaml":
      "api: { name: tasks }\nextends: ./base.yaml\npacks: [./packs/a.yaml, ./packs/c.yaml]\n",
    "packs/c.yaml": "pack: { name: c, version: 1.0.0, extends: [./a.yaml] }\n",
    "base.yaml": "packs: [./packs/a.yaml]\n",
  };
  const r = run(files, "workspace.yaml");
  expect(r.result.diagnostics).toEqual([]);
  expect(r.result.workspace.apis[0]?.layers.map((l) => l.layer)).toEqual([
    "pack:a",
    "pack:b",
    "pack:c",
    "shared",
    "base",
    "api",
  ]);
});

test("settings override by leaf", () => {
  const r = run({
    "api.yaml": [
      "api: { name: tasks }",
      "extends: ./base.yaml",
      "packs: [./pack.yaml]",
      "conventions:",
      "  paging: { maxLimit: 50 }",
      "  errors:",
      "    every: [b, a]",
      "    derived: { forbidden: api.denied }",
      "  cache: { families: { minute: 120s } }",
      "",
    ].join("\n"),
    "pack.yaml": [
      "pack: { name: p, version: 1.0.0 }",
      "conventions:",
      "  paging: { default: offset, maxLimit: 20 }",
      "  errors: { every: [a], derived: { forbidden: api.forbidden, missing: api.missing } }",
      "  cache: { families: { minute: 60s, hour: 1h } }",
      "",
    ].join("\n"),
    "base.yaml": "conventions:\n  paging: { default: cursor }\n  header: { name: X }\n",
  });
  expect(r.result.diagnostics).toEqual([]);
  const api = must(r.result.workspace.apis[0]);
  expect(api.merged.conventions).toEqual({
    paging: { default: "cursor", maxLimit: 50 },
    errors: {
      every: ["a", "b"],
      derived: { forbidden: "api.denied", missing: "api.missing" },
    },
    cache: { families: { minute: "120s", hour: "1h" } },
    header: { name: "X" },
  });
  const o = api.leafOrigins;
  expect(o["/conventions/paging/default"]).toEqual({
    layer: "base",
    pointer: "/conventions/paging/default",
  });
  expect(o["/conventions/paging/maxLimit"]?.layer).toBe("api");
  expect(o["/conventions/errors/derived/missing"]?.layer).toBe("pack:p");
  expect(o["/conventions/errors/derived/forbidden"]?.layer).toBe("api");
  expect(o["/conventions/cache/families/hour"]?.layer).toBe("pack:p");
  expect(o["/conventions/cache/families/minute"]?.layer).toBe("api");
  expect(o["/conventions/header/name"]?.layer).toBe("base");
});

test("include keeps position", () => {
  const inline = run({
    "api.yaml": "api: { name: t }\nschemas:\n  Task:\n    first: 1\n    second: 2\n    third: 3\n",
  });
  const included = run({
    "api.yaml":
      "api: { name: t }\nschemas:\n  Task:\n    first: 1\n    $include: ./mid.yaml\n    third: 3\n",
    "mid.yaml": "second: 2\n",
  });
  const a = must(inline.result.workspace.apis[0]);
  const b = must(included.result.workspace.apis[0]);
  expect(JSON.stringify(b.merged)).toBe(JSON.stringify(a.merged));
  expect(Object.keys((b.merged.schemas as { Task: object }).Task)).toEqual([
    "first",
    "second",
    "third",
  ]);
  expect(b.leafOrigins).toEqual(a.leafOrigins);
  expect(b.locations["api#/schemas/Task/second"]).toMatchObject({ file: "mid.yaml", line: 1 });
  expect(a.locations["api#/schemas/Task/second"]).toMatchObject({ file: "api.yaml" });
});

test("include merges several files in list order and takes a pointer", () => {
  const r = run({
    "api.yaml":
      "api: { name: t }\nschemas:\n  $include: [./a.yaml, ./b.yaml#/Inner]\n  Own: { type: string }\n",
    "a.yaml": "A: { type: string }\n",
    "b.yaml": "Inner:\n  B: { type: string }\nOther: {}\n",
  });
  expect(r.result.diagnostics).toEqual([]);
  expect(Object.keys((r.result.workspace.apis[0]?.merged.schemas ?? {}) as object)).toEqual([
    "A",
    "B",
    "Own",
  ]);
});

test("include is refused under routes, and nowhere else", () => {
  const r = run({
    "api.yaml": "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      $include: ./r.yaml\n",
    "r.yaml": "list: {}\n",
  });
  expect(rules(r)).toEqual(["include-under-routes"]);
});

test("in a data position only a mapping holding $file alone is processed", () => {
  const r = run({
    "api.yaml": [
      "api: { name: t }",
      "examples:",
      "  one: { value: { $include: ./nope.yaml, $ref: X } }",
      "  two: { value: { $file: ./ex.json } }",
      "  three: { value: { $file: ./ex.yaml } }",
      "",
    ].join("\n"),
    "ex.json": '{"a": [1, 2]}',
    "ex.yaml": "b: 1\n",
  });
  expect(r.result.diagnostics).toEqual([]);
  expect(r.result.workspace.apis[0]?.merged.examples).toEqual({
    one: { value: { $include: "./nope.yaml", $ref: "X" } },
    two: { value: { a: [1, 2] } },
    three: { value: { b: 1 } },
  });
});

test("file directives: text, missing file, yaml pitfalls", () => {
  const r = run({
    "api.yaml":
      "api: { name: t }\nd: { $file: ./d.md }\nm: { $file: ./gone.md }\nyy: { $file: ./e.yaml }\n",
    "d.md": "\uFEFFline one\r\nline two\r\n",
    "e.yaml": "flag: yes\n",
  });
  expect(rules(r)).toEqual(["file-missing", "yaml-boolean"]);
  expect(r.result.workspace.apis[0]?.merged.d).toBe("line one\nline two\n");
  expect(r.printed).toContain("api.yaml:3:13: error seampact/load/file-missing");
  expect(r.printed).toContain("e.yaml:1:7: error seampact/load/yaml-boolean");
});

test("a file $ref used twice yields one element, and it keeps its identity", () => {
  const r = run({
    "api.yaml":
      "api: { name: t }\nsurfaces:\n  app:\n    one: { output: { $ref: ./schemas/task.yaml#/Task } }\n    two: { output: { $ref: ./schemas/task.yaml#/Task } }\n",
    "schemas/task.yaml":
      "Task:\n  type: object\n  properties: { owner: { $ref: Owner } }\nOwner: { type: string }\nUnused: { type: string }\n",
  });
  expect(r.result.diagnostics).toEqual([]);
  const m = must(r.result.workspace.apis[0]).merged as {
    schemas: object;
    surfaces: { app: Record<string, { output: object }> };
  };
  expect(Object.keys(m.schemas)).toEqual(["Task", "Owner"]);
  expect(m.surfaces.app.one?.output).toEqual({ $ref: "Task" });
  expect(m.surfaces.app.two?.output).toEqual({ $ref: "Task" });
  const loc = must(r.result.workspace.apis[0]).locations;
  expect(loc["api#/schemas/Task"]).toMatchObject({ file: "schemas/task.yaml", line: 1 });
});

test("a file both included into a catalogue and reached by $ref is declared once", () => {
  const r = run({
    "api.yaml":
      "api: { name: t }\nschemas:\n  $include: ./schemas/task.yaml\nsurfaces:\n  app:\n    one: { output: { $ref: ./schemas/task.yaml#/Task } }\n",
    "schemas/task.yaml": "Task: { type: object }\n",
  });
  expect(r.result.diagnostics).toEqual([]);
  expect(Object.keys((r.result.workspace.apis[0]?.merged.schemas ?? {}) as object)).toEqual([
    "Task",
  ]);
});

test("a name found both in the referenced file and in the layer is an error naming both", () => {
  const r = run({
    "api.yaml":
      "api: { name: t }\nschemas:\n  Owner: { type: string }\nsurfaces:\n  app:\n    one: { output: { $ref: ./task.yaml#/Task } }\n",
    "task.yaml": "Task:\n  properties: { owner: { $ref: Owner } }\nOwner: { type: integer }\n",
  });
  expect(rules(r)).toEqual(["declaration-twice"]);
  expect(r.printed).toContain("also declared here");
});

test("a pointer into the merged catalogues is refused", () => {
  const r = run({ "api.yaml": "api: { name: t }\nx: { $ref: '#/schemas/Task' }\n" });
  expect(rules(r)).toEqual(["ref-pointer"]);
});

test("workspace api names must equal api.name", () => {
  const r = run(
    {
      "workspace.yaml": "workspace:\n  apis: { tasks: ./api.yaml }\n",
      "api.yaml": "api: { name: other }\n",
    },
    "workspace.yaml",
  );
  expect(rules(r)).toEqual(["api-name-mismatch"]);
});

test("cycle names every file", () => {
  const r = run({
    "api.yaml": "api: { name: t }\nx:\n  $include: ./a.yaml\n",
    "a.yaml": "ka:\n  $include: ./b.yaml\n",
    "b.yaml": "kb:\n  $include: ./c.yaml\n",
    "c.yaml": "kc:\n  $include: ./a.yaml\n",
  });
  expect(rules(r)).toEqual(["include-cycle"]);
  expect(r.result.diagnostics[0]?.message).toContain("a.yaml -> b.yaml -> c.yaml -> a.yaml");
  expect(r.result.diagnostics[0]?.related.map((x) => x.message)).toEqual([
    "'b.yaml' is included here",
    "'c.yaml' is included here",
  ]);
});

test("cycle of pack extends names every file", () => {
  const r = run({
    "api.yaml": "api: { name: t }\npacks: [./a.yaml]\n",
    "a.yaml": "pack: { name: a, version: 1.0.0, extends: [./b.yaml] }\n",
    "b.yaml": "pack: { name: b, version: 1.0.0, extends: [./a.yaml] }\n",
  });
  expect(rules(r)).toEqual(["pack-cycle"]);
  expect(r.result.diagnostics[0]?.message).toContain("a.yaml -> b.yaml -> a.yaml");
});

test("derive entries are declarations and merge in layer order", () => {
  const r = run({
    "api.yaml": "api: { name: t }\npacks: [./a.yaml, ./b.yaml]\n",
    "a.yaml":
      "pack: { name: a, version: 1.0.0 }\nderive:\n  - { entry: crud, select: {} }\n  - { entry: other }\n",
    "b.yaml":
      "pack: { name: b, version: 1.0.0 }\nderive:\n  - { entry: crud }\n  - { entry: more }\n",
  });
  expect(rules(r)).toEqual(["declaration-twice"]);
  const api = must(r.result.workspace.apis[0]);
  expect((api.merged.derive as { entry: string }[]).map((e) => e.entry)).toEqual([
    "crud",
    "other",
    "more",
  ]);
  expect(api.leafOrigins["/derive/2/entry"]).toEqual({
    layer: "pack:b",
    pointer: "/derive/1/entry",
  });
});

test("deterministic across line endings", () => {
  const lf = {
    "api.yaml":
      "api: { name: t }\nextends: ./base.yaml\nschemas:\n  T:\n    $include: ./t.yaml\ndocs: { $file: ./d.md }\n",
    "base.yaml": "errors:\n  a.b: { status: 400 }\n",
    "t.yaml": "type: object\n",
    "d.md": "x\ny\n",
  };
  const crlf = Object.fromEntries(
    Object.entries(lf).map(([k, v]) => [k, `\uFEFF${v.replaceAll("\n", "\r\n")}`]),
  );
  const a = run(lf).result;
  const b = run(crlf).result;
  expect(JSON.stringify(b.workspace)).toBe(JSON.stringify(a.workspace));
  expect(b.diagnostics).toEqual(a.diagnostics);
});

test("apis of one workspace keep their own locations", () => {
  const r = run(
    {
      "workspace.yaml": "workspace:\n  apis: { one: ./one.yaml, two: ./two.yaml }\n",
      "one.yaml": "api: { name: one }\nextends: ./b1.yaml\n",
      "two.yaml": "api: { name: two }\nextends: ./b2.yaml\n",
      "b1.yaml": "rights: { r: {} }\n",
      "b2.yaml": "rights: { r: {} }\n",
    },
    "workspace.yaml",
  );
  const [one, two] = r.result.workspace.apis;
  expect(one?.locations["base#/rights/r"]?.file).toBe("b1.yaml");
  expect(two?.locations["base#/rights/r"]?.file).toBe("b2.yaml");
});

test("a leaf origin resolves to file:line:col through its api's table", () => {
  const r = run(
    {
      "workspace.yaml": "workspace:\n  apis: { one: ./one.yaml, two: ./two.yaml }\n",
      "one.yaml": "api: { name: one }\nextends: ./b1.yaml\n",
      "two.yaml": "api: { name: two }\nextends: ./b2.yaml\n",
      "b1.yaml": "conventions:\n  paging: { maxLimit: 10 }\n",
      "b2.yaml": "\nconventions:\n  paging:\n    maxLimit: 20\n",
    },
    "workspace.yaml",
  );
  expect(r.result.diagnostics).toEqual([]);
  for (const [api, file, line, column] of [
    [r.result.workspace.apis[0], "b1.yaml", 2, 13],
    [r.result.workspace.apis[1], "b2.yaml", 4, 5],
  ] as const) {
    const origin = must(api?.leafOrigins["/conventions/paging/maxLimit"]);
    expect(origin).toEqual({ layer: "base", pointer: "/conventions/paging/maxLimit" });
    expect(diagnosticLocation(origin, must(api).locations)).toEqual({
      file,
      line,
      column,
      endLine: line,
      endColumn: expect.any(Number),
    });
  }
});

test("a file $ref without a pointer needs a file with exactly one element", () => {
  const ok = run({
    "api.yaml": "api: { name: t }\nxx: { $ref: ./one.yaml }\nyy: { $ref: ./one.yaml }\n",
    "one.yaml": "Task: { type: object }\n",
  });
  expect(ok.result.diagnostics).toEqual([]);
  expect(ok.result.workspace.apis[0]?.merged).toMatchObject({
    xx: { $ref: "Task" },
    yy: { $ref: "Task" },
    schemas: { Task: { type: "object" } },
  });
  const many = run({
    "api.yaml": "api: { name: t }\nx: { $ref: ./two.yaml }\n",
    "two.yaml": "A: {}\nB: {}\n",
  });
  expect(rules(many)).toEqual(["ref-file-shape"]);
});
