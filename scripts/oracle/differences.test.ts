import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { differencesProblems, readDifferences } from "./differences.ts";

const DECISION = "docs/adr/0031-rust-core.md#decision";

const entry = (overrides: object = {}): object => ({
  id: "big-integers-exact",
  reason: "Integers above 2^53 are written exactly instead of rounded.",
  decision: DECISION,
  applies: { fixtures: ["golden/every-default/**"], output: "ir", pointer: "/schemas/*/default" },
  change: "value",
  from: 9007199254740992,
  to: 9007199254740993n,
  ...overrides,
});

const document = (...differences: object[]): object => ({ version: 1, differences });

describe("differences.yaml", () => {
  test("the committed file is valid and lists no difference yet", () => {
    expect(readDifferences().differences).toEqual([]);
  });

  test("an entry with a value change, a pointer and a committed anchor is valid", () => {
    expect(differencesProblems(document(entry()))).toEqual([]);
  });

  test("a generated entry names a path, and format applies to generated output only", () => {
    const generated = { fixtures: ["reference"], output: "generated", path: "client/index.ts" };

    expect(differencesProblems(document(entry({ applies: generated, change: "format" })))).toEqual(
      [],
    );
    expect(differencesProblems(document(entry({ change: "format" }))).length).toBeGreaterThan(0);
    expect(
      differencesProblems(document(entry({ applies: { ...generated, pointer: "/a" } }))).length,
    ).toBeGreaterThan(0);
    expect(
      differencesProblems(
        document(entry({ applies: { fixtures: ["x"], output: "ir", path: "a" } })),
      ).length,
    ).toBeGreaterThan(0);
  });

  test("it refuses a bad id, an unknown member, an unknown output and a missing pointer", () => {
    expect(differencesProblems(document(entry({ id: "Big_Integers" }))).length).toBeGreaterThan(0);
    expect(differencesProblems(document(entry({ because: "x" }))).length).toBeGreaterThan(0);
    expect(
      differencesProblems(
        document(entry({ applies: { fixtures: ["x"], output: "yaml", pointer: "" } })),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      differencesProblems(document(entry({ applies: { fixtures: ["x"], output: "ir" } }))).length,
    ).toBeGreaterThan(0);
  });

  test("it refuses a duplicate id and a decision that is no committed anchor", () => {
    expect(differencesProblems(document(entry(), entry()))).toEqual([
      "big-integers-exact: the id is used twice",
    ]);
    expect(
      differencesProblems(document(entry({ decision: "docs/adr/0031-rust-core.md#nowhere" }))),
    ).toEqual(["big-integers-exact: decision docs/adr/0031-rust-core.md has no anchor nowhere"]);
    expect(differencesProblems(document(entry({ decision: "docs/missing.md#a" })))).toEqual([
      "big-integers-exact: decision docs/missing.md is no committed doc",
    ]);
  });

  test("applies takes an optional api and half, and refuses a star inside a pointer segment", () => {
    const applies = (pointer: string): object => ({ fixtures: ["x"], output: "halves", pointer });

    expect(
      differencesProblems(
        document(
          entry({ applies: { ...(applies("/a/*/b") as object), api: "tasks", half: "tree" } }),
        ),
      ),
    ).toEqual([]);
    expect(
      differencesProblems(document(entry({ applies: applies("/a*") }))).length,
    ).toBeGreaterThan(0);
    expect(
      differencesProblems(document(entry({ applies: applies("/**") }))).length,
    ).toBeGreaterThan(0);
    expect(
      differencesProblems(document(entry({ applies: applies("/a/**/b") }))).length,
    ).toBeGreaterThan(0);
  });

  test("it refuses a decision path that climbs out of docs", () => {
    expect(differencesProblems(document(entry({ decision: "docs/../package.json.md#a" })))).toEqual(
      ["big-integers-exact: decision docs/../package.json.md has a '..' segment"],
    );
  });

  test("it reads an integer above 2^53 without rounding it", () => {
    const directory = mkdtempSync(join(tmpdir(), "oracle-differences-"));

    try {
      const path = join(directory, "differences.yaml");

      writeFileSync(
        path,
        `version: 1
differences:
  - id: big-integers-exact
    reason: Integers above 2^53 are written exactly.
    decision: ${DECISION}
    applies: { fixtures: ["a/**"], output: ir, pointer: "/x" }
    change: value
    to: 9007199254740993
`,
      );
      expect(readDifferences(path).differences[0]?.to).toBe(9007199254740993n);
      expect(readDifferences(path).version).toBe(1);
      writeFileSync(path, "version: 2\ndifferences: []\n");
      expect(() => readDifferences(path)).toThrow(/invalid/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
