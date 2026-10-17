import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { printDiagnostics } from "../diagnostics/print.js";
import { must } from "./golden.js";
import { type LoadReader, loadFsReader, loadWorkspace } from "./index.js";
import { loadMemoryReader } from "./reader.js";

function spy(reader: LoadReader) {
  const reads: string[] = [];
  const wrapped: LoadReader = {
    ascent: reader.ascent,
    listDir: (d) => reader.listDir(d),
    realPath: (f) => reader.realPath(f),
    readText: (f, max) => {
      reads.push(f);
      return reader.readText(f, max);
    },
  };
  return { reader: wrapped, reads };
}

const ruleOf = (r: ReturnType<typeof loadWorkspace>) =>
  r.diagnostics.map((d) => d.rule.replace("seampact/load/", ""));

test("path escapes refused", () => {
  const files = {
    "api.yaml": [
      "api: { name: t }",
      "a: { $include: ../outside.yaml }",
      "b: { $include: /etc/passwd }",
      "c: { $include: '.\\x.yaml' }",
      "d: { $include: ./Sub/X.yaml }",
      "e: { $include: ./link.yaml }",
      "f: { $include: ./sub/../../outside.yaml }",
      "g: { $include: 'C:/x.yaml' }",
      "",
    ].join("\n"),
    "../outside.yaml": "secret: 1\n",
    "sub/x.yaml": "ok: 1\n",
  };
  const { reader, reads } = spy(
    loadMemoryReader(files, { links: { "link.yaml": "../outside.yaml" } }),
  );
  const r = loadWorkspace({ reader, entry: "api.yaml" });
  expect(ruleOf(r)).toEqual([
    "path-escape",
    "path-absolute",
    "path-backslash",
    "path-case",
    "path-escape",
    "path-escape",
    "path-absolute",
  ]);
  const printed = printDiagnostics(r.diagnostics, r.workspace.locations);
  expect(printed).toContain("differs in case from the file on disk, 'sub/x.yaml'");
  expect(printed).toContain("through a symbolic link");
  // Nothing outside the root, and no file of the refused paths, was ever read.
  expect(
    reads.filter((p) => p.startsWith("..") || p.includes("outside") || p.includes("etc")),
  ).toEqual([]);
});

test("path escapes refused on disk: ../ and a symlink out of the root", () => {
  const base = mkdtempSync(join(tmpdir(), "seampact-loader-"));
  const root = join(base, "ws");
  mkdirSync(root);
  writeFileSync(join(base, "secret.yaml"), "stolen: 1\n");
  symlinkSync(join(base, "secret.yaml"), join(root, "link.yaml"));
  symlinkSync(base, join(root, "dirlink"));
  writeFileSync(
    join(root, "api.yaml"),
    "api: { name: t }\na: { $include: ../secret.yaml }\nb: { $include: ./link.yaml }\nc: { $include: ./dirlink/secret.yaml }\n",
  );
  const r = loadWorkspace({ reader: loadFsReader(root), entry: "api.yaml" });
  expect(ruleOf(r)).toEqual(["path-escape", "path-escape", "path-escape"]);
  expect(JSON.stringify(r.workspace)).not.toContain("stolen");
  expect(printDiagnostics(r.diagnostics, r.workspace.locations)).not.toContain(base);
});

test("an entry file outside the root is refused", () => {
  const r = loadWorkspace({ reader: loadMemoryReader({}), entry: "../api.yaml" });
  expect(ruleOf(r)).toEqual(["path-escape"]);
});

function packFiles(extra: Record<string, string> = {}, pkg = {}) {
  return {
    "api.yaml": "api: { name: t }\npacks: ['@acme/pack-a']\n",
    "node_modules/@acme/pack-a/package.json": JSON.stringify({
      name: "@acme/pack-a",
      version: "1.2.0",
      seampact: { role: "pack", pack: "lib/pack.yaml" },
      ...pkg,
    }),
    "node_modules/@acme/pack-a/lib/pack.yaml":
      "pack: { name: '@acme/pack-a', version: 1.2.0 }\nrights:\n  r.one: {}\nconventions:\n  paging: { default: cursor }\n",
    ...extra,
  };
}

test("pack resolution", () => {
  // From the workspace root's own node_modules, the entry named by seampact.pack.
  const ok = loadWorkspace({ reader: loadMemoryReader(packFiles()), entry: "api.yaml" });
  expect(ok.diagnostics).toEqual([]);
  const api = must(ok.workspace.apis[0]);
  expect(api.layers.map((l) => [l.layer, l.file])).toEqual([
    ["pack:@acme/pack-a", "node_modules/@acme/pack-a/lib/pack.yaml"],
    ["api", "api.yaml"],
  ]);
  expect(api.leafOrigins["/conventions/paging/default"]?.layer).toBe("pack:@acme/pack-a");
  expect(api.locations["pack:@acme/pack-a#/rights/r.one"]?.file).toBe(
    "node_modules/@acme/pack-a/lib/pack.yaml",
  );

  // From a node_modules above the workspace root.
  const above = packFiles();
  const lifted = Object.fromEntries(
    Object.entries(above).map(([k, v]) => [k.startsWith("node_modules") ? `../${k}` : k, v]),
  );
  const up = loadWorkspace({ reader: loadMemoryReader(lifted), entry: "api.yaml" });
  expect(up.diagnostics).toEqual([]);
  expect(up.workspace.apis[0]?.layers[0]?.file).toBe("../node_modules/@acme/pack-a/lib/pack.yaml");

  // Not installed.
  const none = loadWorkspace({
    reader: loadMemoryReader({ "api.yaml": packFiles()["api.yaml"] }),
    entry: "api.yaml",
  });
  expect(ruleOf(none)).toEqual(["pack-not-found"]);

  // A manifest version that differs from package.json.
  const bad = loadWorkspace({
    reader: loadMemoryReader(packFiles({}, { version: "1.3.0" })),
    entry: "api.yaml",
  });
  expect(ruleOf(bad)).toEqual(["pack-version-mismatch"]);
  expect(bad.diagnostics[0]?.message).toContain("1.2.0");
  expect(bad.diagnostics[0]?.message).toContain("1.3.0");

  // A package that is not a pack.
  const notPack = loadWorkspace({
    reader: loadMemoryReader(packFiles({}, { seampact: { role: "core" } })),
    entry: "api.yaml",
  });
  expect(ruleOf(notPack)).toEqual(["pack-package"]);
});

test("pack resolution through a symlinked package keeps the pack inside its package", () => {
  const files = packFiles();
  const moved = Object.fromEntries(
    Object.entries(files).map(([k, v]) => [
      k.startsWith("node_modules/@acme") ? k.replace("node_modules/@acme", "store/@acme") : k,
      v,
    ]),
  );
  const r = loadWorkspace({
    reader: loadMemoryReader(moved, {
      links: { "node_modules/@acme/pack-a": "store/@acme/pack-a" },
    }),
    entry: "api.yaml",
  });
  expect(r.diagnostics).toEqual([]);
});

test("a pack holding anything but pack keys is refused (SCN-047)", () => {
  const r = loadWorkspace({
    reader: loadMemoryReader({
      "api.yaml": "api: { name: t }\npacks: [./p.yaml]\n",
      "p.yaml":
        "pack: { name: p, version: 1.0.0 }\nsurfaces: {}\nhook: 'console.log(1)'\nrights: { r: {} }\n",
    }),
    entry: "api.yaml",
  });
  expect(ruleOf(r)).toEqual(["pack-not-data", "pack-not-data"]);
  expect(printDiagnostics(r.diagnostics, r.workspace.locations)).toContain(
    "p.yaml:2:1: error seampact/load/pack-not-data: the pack file 'p.yaml' holds 'surfaces'",
  );
});

test("a pack's relative paths stay inside its package", () => {
  const r = loadWorkspace({
    reader: loadMemoryReader(
      packFiles({
        "node_modules/@acme/pack-a/lib/pack.yaml":
          "pack: { name: '@acme/pack-a', version: 1.2.0 }\nrights: { $include: ../../../../api.yaml }\n",
      }),
    ),
    entry: "api.yaml",
  });
  expect(ruleOf(r)).toEqual(["path-escape"]);
});

test("a pack manifest is required, and a pack name is unique", () => {
  const r = loadWorkspace({
    reader: loadMemoryReader({
      "api.yaml": "api: { name: t }\npacks: [./a.yaml, ./b.yaml]\n",
      "a.yaml": "pack: { name: same, version: 1.0.0 }\n",
      "b.yaml": "pack: { name: same, version: 2.0.0 }\n",
    }),
    entry: "api.yaml",
  });
  expect(ruleOf(r)).toEqual(["pack-name-clash"]);
  const none = loadWorkspace({
    reader: loadMemoryReader({
      "api.yaml": "api: { name: t }\npacks: [./a.yaml]\n",
      "a.yaml": "rights: {}\n",
    }),
    entry: "api.yaml",
  });
  expect(ruleOf(none)).toEqual(["pack-manifest"]);
});
