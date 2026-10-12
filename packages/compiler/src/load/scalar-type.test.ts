import { describe, expect, test } from "vitest";
import { printDiagnostics } from "../diagnostics/print.js";
import { loadWorkspace } from "./index.js";
import { loadMemoryReader } from "./reader.js";

function load(files: Record<string, string>, entry = "api.yaml") {
  const result = loadWorkspace({ reader: loadMemoryReader(files), entry });
  const rules = result.diagnostics.map((d) => d.rule.replace("seampact/load/", ""));
  return {
    result,
    rules,
    printed: printDiagnostics(result.diagnostics, result.workspace.locations),
  };
}

// Each case: a document with `$V` where the scalar goes, the values the schema refuses there
// (one per YAML type it does not accept, null in its three spellings) and the values it accepts.
interface Case {
  name: string;
  expects: string;
  doc: string;
  refused: string[];
  accepted: string[];
}

const NULLS = ["~", "null", ""];
const CASES: Case[] = [
  {
    name: "a string (api.summary)",
    expects: "a string",
    doc: "api: { name: t, summary: $V }\n",
    refused: ["12", "1.5", "true", ...NULLS],
    accepted: ["text", "'12'", '"true"', "'~'"],
  },
  {
    name: "an integer (a scalar's minLength)",
    expects: "an integer",
    doc: "api: { name: t }\nscalars:\n  Id: { type: string, minLength: $V }\n",
    refused: ["'3'", "1.5", "true", ...NULLS],
    accepted: ["3", "0", "3.0"],
  },
  {
    name: "a number (a scalar's maximum)",
    expects: "a number",
    doc: "api: { name: t }\nscalars:\n  Id: { type: integer, maximum: $V }\n",
    refused: ["'3'", "true", ...NULLS],
    accepted: ["3", "3.5", "-1"],
  },
  {
    name: "a boolean (a route's internal)",
    expects: "a boolean",
    doc: "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        internal: $V\n",
    refused: ["'true'", "1", "1.5", ...NULLS],
    accepted: ["true", "false"],
  },
  {
    name: "a string or an integer (api.version)",
    expects: "an integer or a string",
    doc: "api: { name: t, version: $V }\n",
    refused: ["1.5", "true", ...NULLS],
    accepted: ["1", "'2027-06-30'"],
  },
  {
    name: "a mapping (a scalar written for routes)",
    expects: "a mapping",
    doc: "api: { name: t }\nsurfaces:\n  app:\n    routes: $V\n",
    refused: ["12", "text", "true", ...NULLS],
    accepted: ["{}"],
  },
  {
    name: "a list (a scalar written for upstream)",
    expects: "a list",
    doc: "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        upstream: $V\n",
    refused: ["12", "text", "true", ...NULLS],
    accepted: ["[a]"],
  },
];

describe("p6 typed scalar", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      test.each(c.refused)("refuses %j", (value) => {
        const r = load({ "api.yaml": c.doc.replace("$V", value) });
        expect(r.rules).toEqual(["scalar-type"]);
        expect(r.result.diagnostics[0]?.message).toContain(`the schema expects ${c.expects}`);
        expect(r.printed).toMatch(
          /^api\.yaml:\d+:\d+: error seampact\/load\/scalar-type: .+ Fix: .+\.$/,
        );
      });
      test.each(c.accepted)("accepts %j", (value) => {
        const r = load({ "api.yaml": c.doc.replace("$V", value) });
        expect(r.rules).toEqual([]);
      });
    });
  }

  test("the diagnostic is located at the scalar", () => {
    const r = load({ "api.yaml": "api:\n  name: t\n  summary: 12\n" });
    expect(r.printed.split(" ")[0]).toBe("api.yaml:3:12:");
  });

  test("a quoted number is a string, and refused where a number goes", () => {
    const r = load({
      "api.yaml": "api: { name: t }\nscalars:\n  Id: { type: string, minLength: '3' }\n",
    });
    expect(r.result.diagnostics[0]?.message).toContain("'\"3\"' is a string");
  });

  test("a position the schemas say nothing about is left to the validate stage", () => {
    const r = load({
      "api.yaml":
        "api: { name: t }\nnotAKeyword: 12\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        madeUp: [1, true, ~]\n",
    });
    expect(r.rules).toEqual([]);
  });

  test("a data position takes any type, null written null", () => {
    const doc = (v: string) =>
      `api: { name: t }\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        examples:\n          e: { status: 200, value: ${v} }\n`;
    for (const v of ["12", "true", "'x'", "[1, null]", "null", "{ a: 1.5 }"]) {
      expect(load({ "api.yaml": doc(v) }).rules).toEqual([]);
    }
    expect(load({ "api.yaml": doc("~") }).rules).toEqual(["data-null"]);
  });

  test("a scalar in a pack file is typed by the pack schema", () => {
    const r = load({
      "api.yaml": "api: { name: t }\npacks: [./p.yaml]\n",
      "p.yaml":
        "pack: { name: p, version: 1.0.0 }\nscalars:\n  Id: { type: string, minLength: x }\n",
    });
    expect(r.rules).toEqual(["scalar-type"]);
    expect(r.printed).toContain("p.yaml:3:");
  });

  test("a scalar reached through $include is typed at the including position", () => {
    const r = load({
      "api.yaml": "api: { name: t }\nscalars:\n  Id: { type: string, $include: ./id.yaml }\n",
      "id.yaml": "minLength: x\n",
    });
    expect(r.rules).toEqual(["scalar-type"]);
    expect(r.printed).toContain("id.yaml:1:12:");
  });
});

describe("p6 beside p1 to p4", () => {
  test("a scalar P1 to P4 already refuse gets no P6 report", () => {
    for (const v of ["1_000", "0x1F", "yes", "2027-06-30"]) {
      const r = load({
        "api.yaml": `api: { name: t }\nscalars:\n  Id: { type: integer, maximum: ${v} }\n`,
      });
      expect(r.rules).toHaveLength(1);
      expect(r.rules).not.toContain("scalar-type");
    }
  });
});

describe("authored text in messages", () => {
  test("a scalar-type message writes an active character escaped", () => {
    const r = load({
      "api.yaml": 'api: { name: t }\nscalars:\n  Id: { type: string, minLength: "a\\u202Eb" }\n',
    });
    expect(r.rules).toEqual(["scalar-type"]);
    const d = r.result.diagnostics[0];
    expect(d?.message).not.toMatch(/\u202E/u);
    expect(d?.message).toContain("\\u202E");
    expect(d?.fix).not.toMatch(/\u202E/u);
  });

  test("a pack-name message writes an active character escaped", () => {
    const r = load({
      "api.yaml": "api: { name: t }\npacks: [./p.yaml]\n",
      "p.yaml": 'pack: { name: "a#\\u202Eb", version: 1.0.0 }\n',
    });
    expect(r.rules).toEqual(["pack-name"]);
    expect(r.result.diagnostics[0]?.message).not.toMatch(/\u202E/u);
    expect(r.result.diagnostics[0]?.message).toContain("\\u202E");
  });
});

test("a package-name message writes an active character escaped", () => {
  const r = load({ "api.yaml": 'api: { name: t }\npacks: ["a\\u202Eb"]\n' });
  expect(r.rules).toEqual(["pack-name"]);
  expect(r.result.diagnostics[0]?.message).not.toMatch(/\u202E/u);
  expect(r.result.diagnostics[0]?.message).toContain("\\u202E");
});

describe("pack names", () => {
  test("a '#' in a pack name is refused", () => {
    const r = load({
      "api.yaml": "api: { name: t }\npacks: [./p.yaml]\n",
      "p.yaml": "pack: { name: 'a#/~load/x', version: 1.0.0 }\n",
    });
    expect(r.rules).toEqual(["pack-name"]);
    expect(r.printed).toContain("p.yaml:1:15:");
    expect(r.result.diagnostics[0]?.message).toContain("holds a '#'");
  });
});

describe("data positions in lists", () => {
  test("a list item of a data list is data: null spelled null, directives kept literal", () => {
    const r = load({
      "api.yaml":
        "api: { name: t }\nschemas:\n  T:\n    type: string\n    examples: [~, { $include: ./x.yaml }, { $ref: X }]\n",
      "x.yaml": "a: 1\n",
    });
    expect(r.rules).toEqual(["data-null"]);
    expect(r.printed).toContain("api.yaml:5:16:");
    const schemas = r.result.workspace.apis[0]?.merged.schemas as Record<string, unknown>;
    expect((schemas.T as { examples: unknown }).examples).toEqual([
      null,
      { $include: "./x.yaml" },
      { $ref: "X" },
    ]);
    expect(r.result.files).not.toContain("x.yaml");
  });
});
