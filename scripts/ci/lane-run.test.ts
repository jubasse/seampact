import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const LANE_RUN_SCRIPT = join(REPO, ".github/actions/lane-changes/lane-run.sh");

// A lane that watches every path, so only the documentation fast path can make it skip.
const EVERY_PATH = ".";
const PACKAGES_ONLY = "^packages/|^\\.github/workflows/p4-msw\\.yml$";

function decideLaneRun(watchedPathsPattern: string, changedPaths: readonly string[]): string {
  const run = spawnSync("bash", [LANE_RUN_SCRIPT, watchedPathsPattern], {
    input: changedPaths.map((changedPath) => `${changedPath}\0`).join(""),
    encoding: "utf8",
  });

  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);

  return run.stdout.trim();
}

describe("the documentation fast path", () => {
  it.each([
    ["a root Markdown file", ["README.md"]],
    [
      "a nested Markdown file outside the packages",
      ["jvm/README.md", ".claude/agents/seampact-writer.md"],
    ],
    ["a file under docs/", ["docs/guides/start.md", "docs/images/flow.svg"]],
  ])("skips the lane for %s", (_label, changedPaths) => {
    expect(decideLaneRun(EVERY_PATH, changedPaths)).toBe("false");
  });

  it.each([
    ["the grammar", ["docs/grammar/x.md"]],
    ["the IR", ["docs/ir/03-types.md"]],
    ["the conformance checklist", ["docs/conformance/checklist.yaml"]],
    ["a package README", ["packages/foo/README.md"]],
    ["a fixture README", ["fixtures/reference/README.md"]],
    ["a move from docs/ into a package", ["docs/a.md", "packages/x.ts"]],
    ["documentation and code together", ["README.md", "scripts/consumers/cli.ts"]],
  ])("runs the lane for %s", (_label, changedPaths) => {
    expect(decideLaneRun(EVERY_PATH, changedPaths)).toBe("true");
  });
});

describe("the watched paths", () => {
  it("runs the lane when a changed path matches one", () => {
    expect(decideLaneRun(PACKAGES_ONLY, ["packages/core/spec/src/index.ts"])).toBe("true");
    expect(decideLaneRun(PACKAGES_ONLY, [".github/workflows/p4-msw.yml"])).toBe("true");
  });

  it("skips the lane when no changed path matches", () => {
    expect(
      decideLaneRun(PACKAGES_ONLY, ["jvm/build.gradle.kts", ".github/workflows/p4-msw.yml.bak"]),
    ).toBe("false");
  });

  it("matches a path with a space, a quote or a non-ASCII byte as written", () => {
    expect(decideLaneRun(PACKAGES_ONLY, ["packages/a b/it's-é.ts"])).toBe("true");
  });

  it("runs every job on an empty change list", () => {
    expect(decideLaneRun(PACKAGES_ONLY, [])).toBe("true");
  });
});
