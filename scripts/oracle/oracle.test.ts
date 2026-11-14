import { expect, test } from "vitest";
import { checkFixtures, checkReport, ruleCoverage } from "./commands.ts";
import { loadOracleCompiler } from "./compiler.ts";
import { expectedFilesOf } from "./expected.ts";
import { discoverFixtures, readExcluded } from "./fixtures.ts";
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

test("a half that reports gets a diagnostics file and an api with schema calls gets a call log", async () => {
  const compiler = await loadOracleCompiler();
  const excluded = readExcluded();
  const filesOf = (path: string) => {
    const fixture = discoverFixtures().find((candidate) => candidate.path === path);

    if (fixture === undefined) throw new Error(`no fixture ${path}`);

    return expectedFilesOf(compiler, fixture, excluded);
  };

  const names = [...filesOf("bundle-channels/imports/tasks-service").keys()];

  expect(names).toContain("halves/tasksService/02-tree.nodes.diagnostics.json");
  expect([...filesOf("big-integers/above-2-pow-53").keys()]).toContain("schema-calls/bigints.json");
  expect(names.filter((name) => name.endsWith(".diagnostics.json")).length).toBeLessThan(
    names.filter((name) => name.startsWith("halves/")).length,
  );
});

test("a converted fixture is one workspace: no fixture is found below it", () => {
  const converted = discoverFixtures().filter(({ path }) => path.startsWith("converted/"));

  expect(converted.length).toBeGreaterThan(0);

  for (const { path } of converted)
    expect(converted.filter((other) => other.path.startsWith(`${path}/`))).toEqual([]);
});
