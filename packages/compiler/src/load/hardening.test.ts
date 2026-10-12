// Regression tests for the security review of p1-loader (iteration 1): every repro of the
// review, each failing before its fix.
import * as path from "node:path";
import { afterEach, expect, test } from "vitest";
import { printDiagnostics } from "../diagnostics/print.js";
import { must } from "./golden.js";
import { loadWorkspace } from "./index.js";
import { isInside } from "./paths.js";
import {
  type LoadMemoryOptions,
  type LoadReader,
  loadAscentOf,
  loadMemoryReader,
  loadRootRelative,
} from "./reader.js";

function spy(reader: LoadReader) {
  const reads: string[] = [];
  const listed: string[] = [];
  const wrapped: LoadReader = {
    ascent: reader.ascent,
    listDir: (d) => {
      listed.push(d);
      return reader.listDir(d);
    },
    realPath: (f) => reader.realPath(f),
    readText: (...args) => {
      reads.push(args[0]);
      return reader.readText(...args);
    },
  };
  return { reader: wrapped, reads, listed };
}

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

const victim = {
  "../../victim/proj/package.json": JSON.stringify({
    name: "x",
    version: "1.0.0",
    seampact: { role: "pack", pack: "pack.yaml" },
  }),
  "../../victim/proj/pack.yaml": "pack: { name: x, version: 1.0.0 }\nrights: { stolen: {} }\n",
};

test("C-4 a package name that leaves node_modules is refused before any read", () => {
  for (const name of [
    "x/../../../../victim/proj",
    "@x/../../../../victim/proj",
    "..",
    "x\\..\\..",
    "Upper",
    ".hidden",
    "@scope/",
    "a/b/c",
    "x".repeat(215),
  ]) {
    const { reader, reads } = spy(
      loadMemoryReader({ "api.yaml": `api: { name: t }\npacks: ['${name}']\n`, ...victim }),
    );
    const r = loadWorkspace({ reader, entry: "api.yaml" });
    expect(rules(r), name).toEqual(["pack-name"]);
    expect(reads, name).toEqual(["api.yaml"]);
    expect(JSON.stringify(r.workspace), name).not.toContain("stolen");
  }
});

test("C-4 a pack extends naming a bad package is refused too", () => {
  const r = run({
    "api.yaml": "api: { name: t }\npacks: [./p.yaml]\n",
    "p.yaml": "pack: { name: p, version: 1.0.0, extends: ['x/../../../../victim/proj'] }\n",
    ...victim,
  });
  expect(rules(r)).toEqual(["pack-name"]);
});

test("C-4 seampact.pack is a path inside the package", () => {
  for (const [entry, rule] of [
    ["../../../api.yaml", "path-escape"],
    ["/etc/passwd", "path-absolute"],
    ["lib\\pack.yaml", "path-backslash"],
  ] as const) {
    const { reader, reads } = spy(
      loadMemoryReader({
        "api.yaml": "api: { name: t }\npacks: ['@acme/p']\n",
        "node_modules/@acme/p/package.json": JSON.stringify({
          name: "@acme/p",
          version: "1.0.0",
          seampact: { role: "pack", pack: entry },
        }),
      }),
    );
    const r = loadWorkspace({ reader, entry: "api.yaml" });
    expect(rules(r), entry).toEqual([rule]);
    expect(reads, entry).toEqual(["api.yaml", "node_modules/@acme/p/package.json"]);
  }
});

test("C-5 an absolute, drive or UNC path is never inside", () => {
  for (const boundary of [".", "node_modules/x"]) {
    for (const p of ["/etc/passwd", "//host/share/x", "D:/x", "d:x", "C:/ws/node_modules/x/a"]) {
      expect(isInside(boundary, p), `${boundary} ${p}`).toBe(false);
    }
  }
  expect(isInside(".", "a/b")).toBe(true);
  expect(isInside("node_modules/x", "node_modules/x/a")).toBe(true);
});

test("C-5 a real path on another drive or share stays absolute, so it is outside", () => {
  const w = path.win32;
  expect(loadRootRelative("C:\\ws", "D:\\x\\y.yaml", w)).toBe("D:/x/y.yaml");
  expect(loadRootRelative("C:\\ws", "\\\\host\\share\\y.yaml", w)).toBe("//host/share/y.yaml");
  expect(isInside(".", loadRootRelative("C:\\ws", "D:\\x\\y.yaml", w))).toBe(false);
  expect(isInside(".", loadRootRelative("C:\\ws", "\\\\host\\share\\y", w))).toBe(false);
  expect(loadRootRelative("C:\\ws", "C:\\ws\\a\\b.yaml", w)).toBe("a/b.yaml");
  expect(loadRootRelative("C:\\ws", "C:\\ws", w)).toBe(".");
  expect(loadRootRelative("/ws", "/ws/a/b.yaml", path.posix)).toBe("a/b.yaml");
});

test("C-5 the node_modules walk counts the steps above the root, not the drive", () => {
  expect(loadAscentOf("C:\\a\\b", path.win32)).toBe(2);
  expect(loadAscentOf("C:\\", path.win32)).toBe(0);
  expect(loadAscentOf("\\\\host\\share\\a", path.win32)).toBe(1);
  expect(loadAscentOf("/a/b", path.posix)).toBe(2);
  expect(loadAscentOf("/", path.posix)).toBe(0);
});

test("nit: no directory is listed through a link that leaves the root, nor is it named", () => {
  const { reader, listed } = spy(
    loadMemoryReader(
      {
        "api.yaml": "api: { name: t }\na: { $include: ./out/deep/x.yaml }\n",
        "../secret/deep/x.yaml": "k: 1\n",
      },
      { links: { out: "../secret" } },
    ),
  );
  const r = loadWorkspace({ reader, entry: "api.yaml" });
  expect(rules(r)).toEqual(["path-escape"]);
  expect(listed.filter((d) => d.startsWith("out"))).toEqual([]);
  expect(printed(r)).not.toContain("secret");
});

test("nit: the checked real path is the one read", () => {
  const { reader, reads } = spy(
    loadMemoryReader(
      { "api.yaml": "api: { name: t }\na: { $include: ./link.yaml }\n", "real.yaml": "k: 1\n" },
      { links: { "link.yaml": "real.yaml" } },
    ),
  );
  const r = loadWorkspace({ reader, entry: "api.yaml" });
  expect(r.diagnostics).toEqual([]);
  expect(reads).toEqual(["api.yaml", "real.yaml"]);
});

function fanOut(n: number): Record<string, string> {
  const files: Record<string, string> = {
    "api.yaml": "api: { name: t }\nx:\n  $include: ./f0.yaml\n",
  };
  for (let i = 0; i < n; i++) {
    files[`f${i}.yaml`] =
      i + 1 < n ? `a:\n  $include: ./f${i + 1}.yaml\nb:\n  $include: ./f${i + 1}.yaml\n` : "z: 1\n";
  }
  return files;
}

test("C-6 an include fan-out stops at the expansion limit", () => {
  const r = run(fanOut(18));
  expect(rules(r)).toEqual(["expansion-limit"]);
  expect(r.diagnostics[0]?.message).toContain("200000");
}, 30_000);

test("C-6 an exponential include fan-out ends quickly", () => {
  const started = Date.now();
  const r = run(fanOut(30));
  expect(rules(r)).toEqual(["expansion-limit"]);
  expect(Date.now() - started).toBeLessThan(10_000);
}, 30_000);

test("C-6 a cycle through a directory link is found on the real path", () => {
  const r = run(
    {
      "api.yaml": "api: { name: t }\nx:\n  $include: ./a.yaml\n",
      "a.yaml": "k:\n  $include: ./loop/a.yaml\n",
    },
    "api.yaml",
    { links: { loop: "." } },
  );
  expect(rules(r)).toEqual(["include-cycle"]);
  expect(r.diagnostics[0]?.message).toContain("a.yaml -> loop/a.yaml");
});

function deepChain(files: number, depth: number): Record<string, string> {
  const block = (leaf: string) =>
    `${Array.from({ length: depth }, (_, i) => `${" ".repeat(i * 2)}a:`).join("\n")}\n${" ".repeat(depth * 2)}${leaf}\n`;
  const out: Record<string, string> = {
    "api.yaml": "api: { name: t }\nx:\n  $include: ./f0.yaml\n",
  };
  for (let i = 0; i < files; i++) {
    out[`f${i}.yaml`] = block(i + 1 < files ? `$include: ./f${i + 1}.yaml` : "z: 1");
  }
  return out;
}

test("C-8 nesting deeper than the limit, through includes, is a located error, not a crash", () => {
  const r = run(deepChain(50, 60));
  expect(rules(r)).toEqual(["too-deep"]);
  expect(printed(r)).toMatch(/^f4\.yaml:\d+:\d+: error seampact\/load\/too-deep: /);
});

test("C-8 a file larger than the byte cap is refused unread", () => {
  const big = `k: '${"x".repeat(4 * 1024 * 1024)}'\n`;
  const r = run({ "api.yaml": "api: { name: t }\nx:\n  $include: ./big.yaml\n", "big.yaml": big });
  expect(rules(r)).toEqual(["file-too-large"]);
  expect(printed(r)).toContain("big.yaml:1:1: error seampact/load/file-too-large");
});

test("C-8 deep JSON data is bounded too", () => {
  const n = 300;
  const r = run({
    "api.yaml": "api: { name: t }\nexamples:\n  one: { value: { $file: ./deep.json } }\n",
    "deep.json": `${"[".repeat(n)}${"]".repeat(n)}`,
  });
  expect(rules(r)).toEqual(["too-deep"]);
});

test("C-9 an authored key with escape sequences prints inert", () => {
  const r = run({ "api.yaml": 'api: { name: t }\nx:\n  "\\e[2J": 1\n  "\\e[2J": 2\n' });
  expect(rules(r)).toEqual(["duplicate-key"]);
  expect(printed(r)).toContain("key '\\u001B[2J' is defined twice");
  expect(printed(r)).not.toContain(String.fromCharCode(27));
});
