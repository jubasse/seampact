import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { discoverFixtures } from "./fixtures.ts";
import { discoverToolCases } from "./tool-cases.ts";
import { cliSpecProblems } from "./tool-cli.ts";

test("a CLI case's tree is no fixture, and every tool case has a known kind", () => {
  const fixtures = discoverFixtures().map(({ path }) => path);
  const cases = discoverToolCases();

  expect(fixtures.filter((path) => path.includes("/tree/") || path.endsWith("/tree"))).toEqual([]);
  expect(cases.filter(({ kind }) => kind === "cli").length).toBeGreaterThan(0);
  expect(new Set(cases.map(({ kind }) => kind))).toEqual(
    new Set(["cli", "diff", "bundle", "merge", "openapi"]),
  );
});

test("cli.json refuses a variable the harness does not set and any unknown member", () => {
  expect(cliSpecProblems({ argv: ["compile"], env: { SEAMPACT_ALLOW_LOCAL: "true" } })).toEqual([]);
  expect(cliSpecProblems({ argv: ["compile"], env: { HOME: "/x" } })).toEqual([
    "env 'HOME' is not one of SEAMPACT_CACHE_DIR, SEAMPACT_ALLOW_LOCAL",
  ]);
  expect(cliSpecProblems({ argv: ["compile"], extra: 1 })).toEqual([
    "'extra' is not a cli.json member",
  ]);
  expect(cliSpecProblems({ cwd: 1 })).toEqual(["argv is an array of strings", "cwd is a string"]);
});
