import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { fixtureDirectory, lintedFixtureText } from "./test-support.js";

// The slice (SCN-018, SCN-087, SCN-109): a workspace compiled, linted by the core rules and printed.

const expectedOf = (fixture: string): string =>
  readFileSync(`${fixtureDirectory(fixture)}expected.txt`, "utf8").trimEnd();

describe("the core rules over the slice workspace", () => {
  test("every rule reports its finding, and a safe exception reports none", () => {
    expect(lintedFixtureText("slice")).toBe(expectedOf("slice"));
  });

  test("an allow with a reason, a disabled rule and a pack's severity leave one error", () => {
    expect(lintedFixtureText("slice-allowed")).toBe(expectedOf("slice-allowed"));
  });
});
