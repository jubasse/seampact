import { expect, test } from "vitest";
import { loadLintPlugins } from "./plugin-loader.js";
import { fixtureDirectory } from "./test-support.js";

const PROJECT = fixtureDirectory("plugin-package");

test("a plugin package installed in the project loads", async () => {
  const outcome = await loadLintPlugins(["acme-lint"], PROJECT);

  expect(outcome.status).toBe("loaded");

  if (outcome.status !== "loaded") return;
  expect(outcome.plugins.map((plugin) => plugin.name)).toEqual(["acme"]);
});

test("a missing package is refused with its name and the install command", async () => {
  const outcome = await loadLintPlugins(["acme-missing"], PROJECT);

  expect(outcome).toEqual({
    status: "refused",
    problems: [
      {
        package: "acme-missing",
        message: "The lint plugin package 'acme-missing' is not installed in the project.",
        fix: "Install it: `pnpm add -D acme-missing`.",
      },
    ],
  });
});

test("an export that defineLintPlugin did not make is refused", async () => {
  const outcome = await loadLintPlugins(["not-a-plugin"], PROJECT);

  expect(outcome.status).toBe("refused");

  if (outcome.status !== "refused") return;
  expect(outcome.problems[0]?.package).toBe("not-a-plugin");
  expect(outcome.problems[0]?.message).toContain("defineLintPlugin");
});

test("every failing package is reported, none is skipped", async () => {
  const outcome = await loadLintPlugins(["acme-missing", "acme-lint", "not-a-plugin"], PROJECT);

  expect(outcome.status === "refused" && outcome.problems.map((p) => p.package)).toEqual([
    "acme-missing",
    "not-a-plugin",
  ]);
});
