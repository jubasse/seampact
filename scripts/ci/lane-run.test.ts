import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const LANE_RUN_SCRIPT = join(REPO, ".github/actions/lane-changes/lane-run.sh");
const CHANGE_RANGE_SCRIPT = join(REPO, ".github/actions/lane-changes/change-range.sh");

// The old tip GitHub sends on the push that creates a branch.
const NEW_BRANCH_BEFORE = "0000000000000000000000000000000000000000";
// A throwaway repository, isolated from the user's git configuration (signing, hooks, default branch).
const ISOLATED_GIT_ENVIRONMENT = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "CI test",
  GIT_AUTHOR_EMAIL: "ci-test@example.invalid",
  GIT_COMMITTER_NAME: "CI test",
  GIT_COMMITTER_EMAIL: "ci-test@example.invalid",
};

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
    [
      "the docs site package",
      [
        "packages/tools/docs-site/astro.config.mjs",
        "packages/tools/docs-site/src/prebuild/link-target.ts",
      ],
    ],
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
    [
      "the docs site package and code together",
      ["packages/tools/docs-site/astro.config.mjs", "scripts/consumers/cli.ts"],
    ],
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

describe("the change range of an event", () => {
  const repository = mkdtempSync(join(tmpdir(), "change-range-"));
  const git = (...gitArguments: string[]): string =>
    execFileSync("git", ["-C", repository, ...gitArguments], {
      encoding: "utf8",
      env: { ...process.env, ...ISOLATED_GIT_ENVIRONMENT },
    }).trim();

  git("-c", "init.defaultBranch=develop", "init", "--quiet");
  git("commit", "--quiet", "--allow-empty", "--message", "base");
  const baseCommit = git("rev-parse", "HEAD");

  git("commit", "--quiet", "--allow-empty", "--message", "group");
  const groupCommit = git("rev-parse", "HEAD");

  afterAll(() => rmSync(repository, { recursive: true, force: true }));

  function changeRange(eventEnvironment: Readonly<Record<string, string>>): string {
    const run = spawnSync("bash", [CHANGE_RANGE_SCRIPT], {
      cwd: repository,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HEAD_SHA: groupCommit, ...eventEnvironment },
    });

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);

    return run.stdout.trim();
  }

  it("compares a pull request with its base branch", () => {
    expect(changeRange({ EVENT: "pull_request", PR_BASE: "develop" })).toBe(
      "origin/develop...HEAD",
    );
  });

  it("compares a merge group with its base commit", () => {
    expect(changeRange({ EVENT: "merge_group", MERGE_GROUP_BASE: baseCommit })).toBe(
      `${baseCommit}..${groupCommit}`,
    );
  });

  it("compares a push with its old tip", () => {
    expect(changeRange({ EVENT: "push", PUSH_BEFORE: baseCommit })).toBe(
      `${baseCommit}..${groupCommit}`,
    );
  });

  it.each([
    ["a new branch", { EVENT: "push", PUSH_BEFORE: NEW_BRANCH_BEFORE }],
    ["a merge group whose base is missing", { EVENT: "merge_group", MERGE_GROUP_BASE: "" }],
    ["the schedule", { EVENT: "schedule" }],
    ["a manual run", { EVENT: "workflow_dispatch" }],
  ])("has no base on %s", (_label, eventEnvironment) => {
    expect(changeRange(eventEnvironment)).toBe("");
  });
});
