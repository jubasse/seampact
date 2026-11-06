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
const LANE_PATHS_SCRIPT = join(REPO, ".github/actions/lane-changes/lane-paths.sh");

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

describe("the package tests", () => {
  it.each([
    ["a package test", ["packages/core/compiler/src/passes/link.test.ts"]],
    ["a test support file", ["packages/core/spec/src/ir/fixture.test-support.ts"]],
    ["a test-support module", ["packages/targets/codegen-ts/src/test-support.ts"]],
  ])("do not wake a lane for %s", (_label, changedPaths) => {
    expect(decideLaneRun(EVERY_PATH, changedPaths)).toBe("false");
  });

  it("wake the lane with a package source next to them", () => {
    expect(
      decideLaneRun(EVERY_PATH, [
        "packages/core/compiler/src/passes/link.test.ts",
        "packages/core/compiler/src/passes/link.ts",
      ]),
    ).toBe("true");
  });

  it.each([
    ["the hooks tests", ["packages/runtime/hooks/src/hooks.test.ts"]],
    [
      "the reference tarball writer",
      ["packages/core/compiler/src/bundle/reference-tarball.test-support.ts"],
    ],
  ])("wake the lane that runs %s itself", (_label, changedPaths) => {
    expect(decideLaneRun(EVERY_PATH, changedPaths)).toBe("true");
  });

  it("are code outside the packages", () => {
    expect(decideLaneRun(EVERY_PATH, ["scripts/consumers/cli.test.ts"])).toBe("true");
  });
});

describe("the paths a lane matches", () => {
  const WATCHED_PATHS = "^packages/\n^fixtures/\n";
  const PULL_REQUEST_PATHS = "^packages/targets/codegen-vue/\n";

  function lanePattern(eventEnvironment: Readonly<Record<string, string>>): string {
    const run = spawnSync("bash", [LANE_PATHS_SCRIPT], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, WATCHED_PATHS, ...eventEnvironment },
    });

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);

    return run.stdout.trim();
  }

  it("are the pull-request paths on a pull request to develop", () => {
    expect(
      lanePattern({
        EVENT: "pull_request",
        PR_BASE: "develop",
        PULL_REQUEST_PATHS,
      }),
    ).toBe("^packages/targets/codegen-vue/");
  });

  it.each([
    ["a merge group", { EVENT: "merge_group" }],
    ["a push", { EVENT: "push" }],
    ["a pull request to main", { EVENT: "pull_request", PR_BASE: "main" }],
  ])("are the watched paths on %s", (_label, eventEnvironment) => {
    expect(lanePattern({ ...eventEnvironment, PULL_REQUEST_PATHS })).toBe("^packages/|^fixtures/");
  });

  it("fall back to the watched paths without pull-request paths", () => {
    expect(lanePattern({ EVENT: "pull_request", PR_BASE: "develop" })).toBe(
      "^packages/|^fixtures/",
    );
  });

  it("refuse empty watched paths", () => {
    const run = spawnSync("bash", [LANE_PATHS_SCRIPT], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, EVENT: "push", WATCHED_PATHS: "\n" },
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("watched-paths is empty");
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
