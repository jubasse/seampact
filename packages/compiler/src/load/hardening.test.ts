// Regression tests for the security review of p1-loader (iteration 1): every repro of the
// review, each failing before its fix.
import { afterEach, expect, test } from "vitest";
import { printDiagnostics } from "../diagnostics/print.js";
import { must } from "./golden.js";
import { loadWorkspace } from "./index.js";
import { type LoadMemoryOptions, loadMemoryReader } from "./reader.js";

function run(files: Record<string, string>, entry = "api.yaml", options?: LoadMemoryOptions) {
  return loadWorkspace({ reader: loadMemoryReader(files, options), entry });
}
const rules = (r: ReturnType<typeof run>) =>
  r.diagnostics.map((d) => d.rule.replace("seampact/load/", ""));
const printed = (r: ReturnType<typeof run>) =>
  printDiagnostics(r.diagnostics, r.workspace.locations);

afterEach(() => {
  // A failed run must not leave Object.prototype polluted for the next test.
  for (const k of ["polluted", "evil"]) delete (Object.prototype as Record<string, unknown>)[k];
});

test("C-1 an authored __proto__ key never reaches Object.prototype", () => {
  const r = run({
    "api.yaml": "api: { name: t }\npacks: [./p.yaml]\nextensions:\n  __proto__: { polluted: 1 }\n",
    "p.yaml": "pack: { name: p, version: 1.0.0 }\nextensions:\n  __proto__: { evil: 1 }\n",
  });
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(({} as Record<string, unknown>).evil).toBeUndefined();
  expect(rules(r)).toEqual(["reserved-key", "reserved-key"]);
  expect(printed(r)).toContain("api.yaml:4:3: error seampact/load/reserved-key");
  expect(printed(r)).toContain("p.yaml:3:3: error seampact/load/reserved-key");
});

test("C-1 constructor and prototype are refused as keys anywhere, data included", () => {
  const r = run({
    "api.yaml": [
      "api: { name: t }",
      "schemas:",
      "  constructor: { type: string }",
      "  T: { properties: { prototype: { type: string } } }",
      "examples:",
      "  one: { value: { __proto__: { polluted: 1 } } }",
      "",
    ].join("\n"),
  });
  expect(rules(r)).toEqual(["reserved-key", "reserved-key", "reserved-key"]);
  const merged = must(r.workspace.apis[0]).merged;
  expect(Object.keys(merged.schemas as object)).toEqual(["T"]);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test("C-1 reserved api names are refused", () => {
  const ws = run(
    {
      "workspace.yaml": "workspace:\n  apis: { __proto__: ./a.yaml, ok: ./b.yaml }\n",
      "a.yaml": "api: { name: __proto__ }\n",
      "b.yaml": "api: { name: ok }\n",
    },
    "workspace.yaml",
  );
  expect(rules(ws)).toEqual(["reserved-key"]);
  expect(ws.workspace.apis.map((a) => a.name)).toEqual(["ok"]);
  const single = run({ "api.yaml": "api: { name: constructor }\n" });
  expect(rules(single)).toEqual(["reserved-key"]);
  expect(single.workspace.apis).toEqual([]);
});

test("C-1 a $file JSON drops and reports a reserved key, and its objects have no prototype", () => {
  const r = run({
    "api.yaml": "api: { name: t }\nexamples:\n  one: { value: { $file: ./ex.json } }\n",
    "ex.json": '{"a": {"__proto__": {"polluted": 1}, "b": 1}}',
  });
  expect(rules(r)).toEqual(["reserved-key"]);
  const value = (must(r.workspace.apis[0]).merged.examples as { one: { value: object } }).one
    .value as { a: object };
  expect(JSON.stringify(value)).toBe('{"a":{"b":1}}');
  expect(Object.getPrototypeOf(value.a)).toBeNull();
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test("C-1 merged trees and visibility have no prototype", () => {
  const r = run({ "api.yaml": "api: { name: t }\nconventions: { paging: { maxLimit: 1 } }\n" });
  const api = must(r.workspace.apis[0]);
  expect(Object.getPrototypeOf(api.merged)).toBeNull();
  expect(Object.getPrototypeOf(api.merged.conventions)).toBeNull();
  expect(Object.getPrototypeOf(api.visibility)).toBeNull();
  expect((api.merged as Record<string, unknown>).constructor).toBeUndefined();
});
