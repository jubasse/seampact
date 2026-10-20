import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { fixtureDirectory, lintedFixtureText, lintedWorkspaceApis } from "./test-support.js";

// The slice (SCN-018, SCN-087, SCN-109): a workspace compiled, linted by the core rules and printed.

const expectedOf = (fixture: string): string =>
  readFileSync(`${fixtureDirectory(fixture)}expected.txt`, "utf8").trimEnd();

describe("the core rules over the slice workspace", () => {
  test("every rule reports its finding, and a safe exception reports none", async () => {
    expect(await lintedFixtureText("slice")).toBe(expectedOf("slice"));
  });

  test("an allow with a reason, a disabled rule and a pack's severity leave one error", async () => {
    expect(await lintedFixtureText("slice-allowed")).toBe(expectedOf("slice-allowed"));
  });
});

test("the reference workspace uses every declaration it reports on", async () => {
  const reference = fileURLToPath(new URL("../../../../fixtures/reference/", import.meta.url));
  const unused = (await lintedWorkspaceApis(reference)).flatMap(({ api, diagnostics }) =>
    diagnostics
      .filter((diagnostic) => diagnostic.rule === "seampact/unused-declaration")
      .map((diagnostic) => `${api}: ${diagnostic.message}`),
  );

  expect(unused).toEqual([]);
});
