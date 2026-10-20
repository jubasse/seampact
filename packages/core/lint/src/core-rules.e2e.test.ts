import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { runLint } from "./run-lint.js";
import {
  compiledFixtureApi,
  fixtureDirectory,
  lintedFixtureText,
  lintedWorkspaceApis,
  lintInputOf,
  rulesOf,
} from "./test-support.js";

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

describe("seampact/not-found-role", () => {
  const notFoundRuleOf = async (fixture: string): Promise<string[]> =>
    rulesOf(await runLint(lintInputOf(compiledFixtureApi(fixture)))).filter((rule) =>
      rule.endsWith("seampact/not-found-role"),
    );

  test("fires when a declared 404 code is not bound to the notFound role", async () => {
    const diagnostics = await runLint(lintInputOf(compiledFixtureApi("not-found-unbound")));
    const [diagnostic] = diagnostics.filter(({ rule }) => rule === "seampact/not-found-role");

    expect(diagnostic?.message).toContain("'notes.not_found'");
    expect(diagnostic?.fix).toContain("errorRoles: { notFound: notes.not_found }");
  });

  test("does not fire when the code is bound to the notFound role", async () => {
    expect(await notFoundRuleOf("not-found-bound")).toEqual([]);
  });

  test("does not fire when the route has one 404 code", async () => {
    expect(await notFoundRuleOf("engine")).toEqual([]);
  });
});
