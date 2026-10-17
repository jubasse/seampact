import { expect, test } from "vitest";
import { loadWorkspace } from "./index.js";
import { loadMemoryReader } from "./reader.js";

// A diagnostic found while a file is parsed (P1 to P5, P9, syntax) carries the layer of the file
// parsed, not the layer that named it.
function layers(files: Record<string, string>, entry = "workspace.yaml") {
  const r = loadWorkspace({ reader: loadMemoryReader(files), entry });

  return r.diagnostics.map((d) => [d.rule.replace("seampact/load/", ""), d.origin.layer]);
}

const API = "api: { name: a, version: 1 }\n";

test("the workspace entry's own pitfall has the workspace layer", () => {
  expect(
    layers({
      "workspace.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n  editorSchemas: yes\n",
      "a.yaml": API,
    }),
  ).toEqual([["yaml-boolean", "workspace"]]);
});

test("an api file's pitfall has the api layer", () => {
  expect(
    layers({
      "workspace.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n",
      "a.yaml": "api: { name: a, version: 1, summary: yes }\n",
    }),
  ).toEqual([["yaml-boolean", "api"]]);
});

test("the shared file's pitfall has the shared layer", () => {
  expect(
    layers({
      "workspace.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n  shared: ./s.yaml\n",
      "a.yaml": API,
      "s.yaml": "scalars:\n  Id: { type: string, title: yes }\n",
    }),
  ).toEqual([["yaml-boolean", "shared"]]);
});

test("a base's pitfall has the base layer", () => {
  expect(
    layers(
      {
        "api.yaml": `${API}extends: ./b.yaml\n`,
        "b.yaml": "scalars:\n  Id: { type: string, title: yes }\n",
      },
      "api.yaml",
    ),
  ).toEqual([["yaml-boolean", "base"]]);
});

test("a pack's pitfall has the pack's layer", () => {
  expect(
    layers(
      {
        "api.yaml": `${API}packs: [./p.yaml]\n`,
        "p.yaml":
          "pack: { name: p, version: 1.0.0 }\nscalars:\n  Id: { type: string, title: yes }\n",
      },
      "api.yaml",
    ),
  ).toEqual([["yaml-boolean", "pack:p"]]);
});
