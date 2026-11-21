import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { ruleCoverage } from "./commands.ts";
import { spawnSync } from "node:child_process";
import { expectedFilesOf, loadOracleContext } from "./expected.ts";
import { discoverFixtures, readExcluded } from "./fixtures.ts";
import { discoverTargets } from "./targets.ts";
import { declaredRuleIds } from "./rule-ids.ts";

// 1.x CI keeps the expected outputs current while the TS compiler lives: `node scripts/oracle/cli.ts write` after
// a change that moves them. The check runs as the CLI does: the recorded CLI calls need Node's own module loader.
test("every fixture and tool case compiles to its expected outputs", () => {
  const run = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("cli.ts", import.meta.url)), "check"],
    {
      encoding: "utf8",
    },
  );
  const [counts = ""] = run.stdout.split("\n");

  expect(counts).toMatch(/^oracle: (\d+) fixtures, \1 match, 0 differ$/);
  expect(run.stdout.trim().split("\n")).toHaveLength(1);
  expect(run.status).toBe(0);
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
  const context = await loadOracleContext();
  const excluded = readExcluded();
  const filesOf = async (path: string) => {
    const target = discoverTargets().find((candidate) => candidate.path === path);

    if (target === undefined) throw new Error(`no fixture ${path}`);

    return expectedFilesOf(context, target, excluded);
  };

  const names = [...(await filesOf("bundle-channels/imports/tasks-service")).keys()];

  expect(names).toContain("halves/tasksService/02-tree.nodes.diagnostics.json");
  expect([...(await filesOf("big-integers/above-2-pow-53")).keys()]).toContain(
    "schema-calls/bigints.json",
  );
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
