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

test("a hand-branded plugin is checked like defineLintPlugin checks it", async () => {
  const outcome = await loadLintPlugins(["forged-lint"], PROJECT);

  expect(outcome).toEqual({
    status: "refused",
    problems: [
      {
        package: "forged-lint",
        message:
          "The lint plugin package 'forged-lint' exports an invalid plugin: the lint rule name 'Bad Name' of plugin 'forged' is not kebab case: use lowercase letters, digits and '-', starting with a letter",
        fix: "Build the plugin with defineLintPlugin and fix what the message names.",
      },
    ],
  });
});

test("a plugin built against another plugin API version is refused", async () => {
  const outcome = await loadLintPlugins(["stale-lint"], PROJECT);

  expect(outcome).toEqual({
    status: "refused",
    problems: [
      {
        package: "stale-lint",
        message:
          "The lint plugin package 'stale-lint' was built against another lint plugin API than version 1.",
        fix: "Rebuild the plugin against this CLI: update its @seampact/lint dependency and publish it again.",
      },
    ],
  });
});
