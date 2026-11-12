import { expect, test } from "vitest";
import { checkFixtures, checkReport, ruleCoverage } from "./commands.ts";
import { declaredRuleIds } from "./rule-ids.ts";

// 1.x CI keeps the expected outputs current while the TS compiler lives: `node scripts/oracle/cli.ts write` after
// a change that moves them.
test("every fixture compiles to its expected outputs", async () => {
  const result = await checkFixtures(undefined);

  expect(result.fixtures).toBeGreaterThan(0);
  expect(checkReport(result)).toBe(
    `oracle: ${result.fixtures} fixtures, ${result.fixtures} match, 0 differ`,
  );
});

test("the rule ids built from a template or a map are declared", () => {
  expect(declaredRuleIds()).toEqual(
    expect.arrayContaining([
      "seampact/load/path-empty",
      "seampact/load/path-escape",
      "seampact/tree/default-value",
      "seampact/tree/extension-value",
    ]),
  );
});

test("every rule id the expected diagnostics hold is declared, and coverage names one that is not", () => {
  expect(ruleCoverage().undeclared).toEqual([]);

  const withoutPathEscape = declaredRuleIds().filter((id) => id !== "seampact/load/path-escape");

  expect(ruleCoverage(withoutPathEscape).undeclared).toEqual(["seampact/load/path-escape"]);
});
