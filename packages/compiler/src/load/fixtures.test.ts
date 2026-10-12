import { expect, test } from "vitest";
import { expectGolden, loadFixture, must } from "./golden.js";

const golden = (dir: string, rules: string[]) => {
  const result = loadFixture(dir);
  expectGolden(dir, result);
  expect(result.diagnostics.map((d) => d.rule.replace("seampact/load/", ""))).toEqual(rules);
  return result;
};

test("fixture: extends conflict names both locations", () => {
  const r = golden("composition/extends-conflict", ["declaration-twice"]);
  expect(r.diagnostics[0]?.related).toHaveLength(1);
});

test("fixture: an identical redefinition is refused too", () => {
  golden("composition/extends-identical", ["declaration-twice"]);
});

test("fixture: a pack holding more than pack keys is refused", () => {
  golden("composition/pack-not-data", ["pack-not-data"]);
});

test("fixture: a pack extends cycle names every file", () => {
  golden("composition/pack-cycle", ["pack-cycle"]);
});

test("fixture: a missing $file is a located error", () => {
  golden("composition/file-missing", ["file-missing"]);
});

test("fixture: bad paths are each refused with their fix", () => {
  golden("composition/paths-refused", [
    "path-escape",
    "path-absolute",
    "path-backslash",
    "path-case",
  ]);
});

test("fixture: a layer sees only itself and what it builds on", () => {
  golden("composition/layer-visibility", ["name-not-visible"]);
});

test("fixture: inline and included routes give the same raw tree", () => {
  const inline = loadFixture("byte-identity/inline");
  const included = loadFixture("byte-identity/included");
  expect(inline.diagnostics).toEqual([]);
  expect(included.diagnostics).toEqual([]);
  const a = inline.workspace.apis[0];
  const b = included.workspace.apis[0];
  expect(JSON.stringify(b?.merged)).toBe(JSON.stringify(a?.merged));
  expect(JSON.stringify(b?.leafOrigins)).toBe(JSON.stringify(a?.leafOrigins));
  expect(b?.locations["api#/surfaces/app/routes/tasks/routes/search/method"]?.file).toBe(
    "routes/search.yaml",
  );
});

test("fixture: a query field named default is not a data position", () => {
  const r = golden("composition/data-positions", []);
  const merged = must(r.workspace.apis[0]).merged as {
    surfaces: { app: { routes: { tasks: { list: Record<string, unknown> } } } };
  };
  const list = merged.surfaces.app.routes.tasks.list;
  expect(list.query).toEqual({ default: { type: "string", maxLength: 20 } });
  expect(list.examples).toEqual({ raw: { value: { $include: "./never-read.yaml" } } });
  expect(r.files).not.toContain("never-read.yaml");
});
