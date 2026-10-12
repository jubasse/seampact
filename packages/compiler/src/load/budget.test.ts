// Regression tests for the security review of p1-loader (iteration 2): every repro of a budget
// bypass, each failing (or overrunning its time bound) before the load budget charged it.
import { expect, test } from "vitest";
import { must } from "./golden.js";
import { loadWorkspace } from "./index.js";
import { type LoadReader, loadMemoryReader } from "./reader.js";

function run(files: Record<string, string>, entry = "api.yaml", reader?: LoadReader) {
  return loadWorkspace({ reader: reader ?? loadMemoryReader(files), entry });
}
const rules = (r: ReturnType<typeof run>) =>
  r.diagnostics.map((d) => d.rule.replace("seampact/load/", ""));

/** Runs `f` and fails when it took longer than `ms`: the bound a linear load stays well inside. */
function timed<T>(ms: number, f: () => T): T {
  const started = performance.now();
  const out = f();
  expect(performance.now() - started).toBeLessThan(ms);
  return out;
}

const times = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

test("D-1 a two-level $include list fan-out over an empty file ends at the expansion limit", () => {
  const n = 5_000;
  const list = (target: string) => `[${times(n, () => target).join(", ")}]`;
  const r = timed(10_000, () =>
    run({
      "api.yaml": `api: { name: t }\nx:\n  $include: ${list("./b.yaml")}\n`,
      "b.yaml": `$include: ${list("./e.yaml")}\n`,
      "e.yaml": "{}\n",
    }),
  );
  expect(rules(r)).toEqual(["expansion-limit"]);
  expect(r.diagnostics[0]?.message).toContain("units of work");
}, 60_000);

test("D-1 many keys then many $include targets in one mapping load in linear time", () => {
  const n = 30_000;
  const r = timed(10_000, () =>
    run({
      "api.yaml": [
        "api: { name: t }",
        "schemas:",
        ...times(n, (i) => `  S${i}: { type: string }`),
        `  $include: [${times(n, () => "./e.yaml").join(", ")}]`,
        "",
      ].join("\n"),
      "e.yaml": "{}\n",
    }),
  );
  expect(r.diagnostics).toEqual([]);
  expect(Object.keys(must(r.workspace.apis[0]).merged.schemas as object)).toHaveLength(n);
}, 120_000);

test("D-2 many apis over one shared layer end at the expansion limit", () => {
  const apis = 1_500;
  const leaves = 8_000;
  const r = timed(10_000, () =>
    run(
      {
        "workspace.yaml": [
          "workspace:",
          "  shared: ./shared.yaml",
          "  apis:",
          ...times(apis, (i) => `    a${i}: ./a${i}.yaml`),
          "",
        ].join("\n"),
        ...Object.fromEntries(times(apis, (i) => [`a${i}.yaml`, `api: { name: a${i} }\n`])),
        "shared.yaml": `conventions:\n${times(leaves, (i) => `  k${i}: 1`).join("\n")}\n`,
      },
      "workspace.yaml",
    ),
  );
  expect(rules(r)).toEqual(["expansion-limit"]);
  expect(r.workspace.apis.length).toBeLessThan(apis);
}, 120_000);

test("D-2 an api overriding every leaf of a large pack merges in linear time", () => {
  const n = 30_000;
  const conventions = (v: number) => times(n, (i) => `  k${i}: ${v}`).join("\n");
  const r = timed(10_000, () =>
    run({
      "api.yaml": `api: { name: t }\npacks: [./p.yaml]\nconventions:\n${conventions(2)}\n`,
      "p.yaml": `pack: { name: p, version: 1.0.0 }\nconventions:\n${conventions(1)}\n`,
    }),
  );
  expect(r.diagnostics).toEqual([]);
  const api = must(r.workspace.apis[0]);
  expect(api.leafOrigins[`/conventions/k${n - 1}`]?.layer).toBe("api");
  expect((api.merged.conventions as Record<string, number>).k0).toBe(2);
}, 120_000);

test("D-3 many $file sites of one large JSON string end at the text limit", () => {
  const sites = 100;
  const r = timed(10_000, () =>
    run({
      "api.yaml": [
        "api: { name: t }",
        "examples:",
        ...times(sites, (i) => `  e${i}: { value: { $file: ./big.json } }`),
        "",
      ].join("\n"),
      "big.json": `"${"x".repeat(4 * 1024 * 1024 - 16)}"`,
    }),
  );
  expect(rules(r)).toEqual(["expansion-limit"]);
  expect(r.diagnostics[0]?.message).toContain("characters of text");
}, 60_000);

test("budget: distinct $include fragments into one large file resolve in linear time", () => {
  const n = 50_000;
  const r = timed(10_000, () =>
    run({
      "api.yaml": `api: { name: t }\nx:\n  $include: [${times(n, (i) => `./k.yaml#/k${i}`).join(", ")}]\n`,
      "k.yaml": `${times(n, (i) => `k${i}: {}`).join("\n")}\n`,
    }),
  );
  expect(r.diagnostics).toEqual([]);
}, 120_000);

test("budget: many distinct file $ref targets are expanded in linear time", () => {
  const n = 30_000;
  const r = timed(10_000, () =>
    run({
      "api.yaml": [
        "api: { name: t }",
        "schemas:",
        "  A:",
        "    properties:",
        ...times(n, (i) => `      p${i}: { $ref: ./s.yaml#/S${i} }`),
        "",
      ].join("\n"),
      "s.yaml": `${times(n, (i) => `S${i}: { type: string }`).join("\n")}\n`,
    }),
  );
  expect(r.diagnostics).toEqual([]);
  expect(Object.keys(must(r.workspace.apis[0]).merged.schemas as object)).toHaveLength(n + 1);
}, 120_000);

test("budget: an $include chain longer than the depth limit is a located error", () => {
  const n = 300;
  const files: Record<string, string> = {
    "api.yaml": "api: { name: t }\nx:\n  $include: ./f0.yaml\n",
  };
  for (let i = 0; i < n; i++) {
    files[`f${i}.yaml`] = i + 1 < n ? `$include: ./f${i + 1}.yaml\n` : "z: 1\n";
  }
  const r = run(files);
  expect(rules(r)).toEqual(["too-deep"]);
});

test("budget: a pack extends chain longer than the depth limit is a located error", () => {
  const n = 300;
  const files: Record<string, string> = { "api.yaml": "api: { name: t }\npacks: [./p0.yaml]\n" };
  for (let i = 0; i < n; i++) {
    const ext = i + 1 < n ? `./p${i + 1}.yaml` : "";
    files[`p${i}.yaml`] = `pack: { name: p${i}, version: 1.0.0, extends: [${ext}] }\n`;
  }
  const r = run(files);
  expect(rules(r)).toEqual(["too-deep"]);
});

test("budget: a directory is listed once however many targets it holds", () => {
  const n = 200;
  const base = loadMemoryReader({
    "api.yaml": `api: { name: t }\nx:\n  $include: [${times(n, (i) => `./f${i}.yaml`).join(", ")}]\n`,
    ...Object.fromEntries(times(n, (i) => [`f${i}.yaml`, `k${i}: 1\n`])),
  });
  let listed = 0;
  const reader: LoadReader = {
    ascent: base.ascent,
    readText: (...a) => base.readText(...a),
    realPath: (f) => base.realPath(f),
    listDir: (d) => {
      listed++;
      return base.listDir(d);
    },
  };
  const r = run({}, "api.yaml", reader);
  expect(r.diagnostics).toEqual([]);
  expect(listed).toBeLessThanOrEqual(2);
});

test("D-4 a property named key keeps its data positions", () => {
  const r = run({
    "api.yaml": [
      "api: { name: t }",
      "schemas:",
      "  T:",
      "    properties:",
      "      key: { type: string, default: ~ }",
      "      paging: { type: string, default: ~ }",
      "schemes:",
      "  s: { kind: signature, key: { value: ~ } }",
      "conventions:",
      "  paging: { default: ~ }",
      "",
    ].join("\n"),
  });
  // The two schema defaults are data (a property named `key` or `paging` keeps its data position);
  // the setting `paging.default` and the scheme `key.value` are strings, so a null there is P6.
  expect(rules(r)).toEqual(["data-null", "data-null", "scalar-type", "scalar-type"]);
  expect(r.diagnostics.slice(0, 2).map((d) => d.message)).toEqual([
    "null is written '~' here; in a data position it must be written null",
    "null is written '~' here; in a data position it must be written null",
  ]);
});
