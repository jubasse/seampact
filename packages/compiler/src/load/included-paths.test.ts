import { expect, test } from "vitest";
import { loadWorkspace } from "./index.js";
import { loadMemoryReader } from "./reader.js";

// ADR 0002 section 2, rule 3: a relative path written in an included file resolves against that
// file, wherever the file that includes it sits.
function load(files: Record<string, string>, entry: string) {
  return loadWorkspace({ reader: loadMemoryReader(files), entry });
}

test("workspace.apis and workspace.shared written in an included file resolve against it", () => {
  const r = load(
    {
      "workspace.yaml": "$include: ./sub/ws.yaml\n",
      "sub/ws.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n  shared: ./shared.yaml\n",
      "sub/a.yaml": "api: { name: a, version: 1 }\n",
      "sub/shared.yaml": "scalars:\n  Id: { type: string }\n",
    },
    "workspace.yaml",
  );
  expect(r.diagnostics).toEqual([]);
  const api = r.workspace.apis[0];
  expect(api?.layers.map((l) => [l.layer, l.file])).toEqual([
    ["shared", "sub/shared.yaml"],
    ["api", "sub/a.yaml"],
  ]);
});

test("extends, packs and pack extends written in an included file resolve against it", () => {
  const r = load(
    {
      "api.yaml": "$include: ./parts/head.yaml\n",
      "parts/head.yaml":
        "api: { name: a, version: 1 }\nextends: ./base.yaml\npacks: [./packs/p.yaml]\n",
      "parts/base.yaml": "scalars:\n  Id: { type: string }\n",
      "parts/packs/p.yaml": "$include: ./m/manifest.yaml\n",
      "parts/packs/m/manifest.yaml": "pack: { name: p, version: 1.0.0, extends: [./q.yaml] }\n",
      "parts/packs/m/q.yaml": "pack: { name: q, version: 1.0.0 }\n",
    },
    "api.yaml",
  );
  expect(r.diagnostics).toEqual([]);
  expect(r.workspace.apis[0]?.layers.map((l) => l.file)).toEqual([
    "parts/packs/m/q.yaml",
    "parts/packs/p.yaml",
    "parts/base.yaml",
    "api.yaml",
  ]);
});
