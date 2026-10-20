import { expect, test } from "vitest";
import { loadMemoryReader } from "../load/reader.js";
import { compileWorkspace } from "./orchestrator.js";

// The declared list holds what finalize prunes from the IR, with the origin of the layer that wins the entry.

test("every catalogue entry is listed with its layer, pruned or not", () => {
  const result = compileWorkspace({
    reader: loadMemoryReader({
      "workspace.yaml": "workspace: { apis: { demo: ./api.yaml }, shared: ./base.yaml }\n",
      "base.yaml": "schemes: { bearer: { kind: bearer }, spare: { kind: bearer } }\n",
      "api.yaml": [
        "api: { name: demo, version: 1 }",
        "packs: [./pack.yaml]",
        "schemas: { Unused: { type: object, properties: { id: { type: string } } } }",
        "",
      ].join("\n"),
      "pack.yaml":
        "pack: { name: house, version: 1.0.0, extends: [] }\nschemes: { offered: { kind: bearer } }\n",
    }),
    entry: "workspace.yaml",
    guard: true,
  });

  expect(result.diagnostics).toEqual([]);
  const [api] = result.apis;

  expect(api?.declared.map(({ catalogue, id, origin }) => [catalogue, id, origin.layer])).toEqual([
    ["schemas", "Unused", "api"],
    ["schemes", "offered", "pack:house"],
    ["schemes", "bearer", "shared"],
    ["schemes", "spare", "shared"],
  ]);
  expect(api?.ir?.schemas).not.toHaveProperty("Unused");
});
