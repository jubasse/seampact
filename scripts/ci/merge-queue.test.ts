import { describe, expect, it } from "vitest";
import { readWorkflow, type WorkflowDocument, workflowFiles } from "./matrix-rows.ts";

// The checks develop's ruleset requires; the merge queue waits for each of them on every merge group.
const REQUIRED_CHECKS = [
  "ci",
  "checklist",
  "native-ir",
  "golden-determinism",
  "bundle-determinism",
  "channel-smoke",
  "hooks-native",
  "binary",
  "p6-react",
  "jvm-core",
  "spring-boot",
  "jvm-plugins",
  "p6-vue",
  "p6-angular",
  "p4-msw",
  "php-core",
  "own-validators",
  "laravel",
  "symfony",
  "python-core",
  "fastapi",
  "drf",
  "ninja",
  "adonis",
  "express-fastify",
  "hono",
  "nestjs",
  "packed-consumer",
  "docs-site",
  "release",
  "generation-determinism",
] as const;

const MERGE_GROUP_ACTIVITY = "checks_requested";
const QUEUED_BRANCH = "develop";

// A job reports its check under its name, or under its id when it has none.
function reportedChecks(document: WorkflowDocument): string[] {
  return Object.entries(document.jobs).map(([jobId, job]) => job.name ?? jobId);
}

function requiredCheckWorkflows(): Map<string, string[]> {
  const workflowsByCheck = new Map<string, string[]>();

  for (const file of workflowFiles()) {
    const checks = new Set(reportedChecks(readWorkflow(file)));

    for (const check of REQUIRED_CHECKS) {
      if (!checks.has(check)) continue;

      workflowsByCheck.set(check, [...(workflowsByCheck.get(check) ?? []), file]);
    }
  }

  return workflowsByCheck;
}

function workflowsOnMergeGroup(): string[] {
  return workflowFiles().filter((file) => "merge_group" in readWorkflow(file).on);
}

describe("the merge queue", () => {
  const workflowsByCheck = requiredCheckWorkflows();
  const producingWorkflows = [...new Set([...workflowsByCheck.values()].flat())].sort();

  it.each(REQUIRED_CHECKS)("finds a workflow that reports the required check %s", (check) => {
    expect(workflowsByCheck.get(check), `no workflow job reports '${check}'`).toBeDefined();
  });

  it("runs on a merge group exactly the workflows that report a required check", () => {
    expect(workflowsOnMergeGroup()).toEqual(producingWorkflows);
  });

  it.each(workflowsOnMergeGroup())("runs %s on develop's merge groups", (file) => {
    expect(readWorkflow(file).on.merge_group).toMatchObject({
      types: [MERGE_GROUP_ACTIVITY],
      branches: expect.arrayContaining([QUEUED_BRANCH]),
    });
  });

  // A merge group's ref names the group, so a group keyed on the ref never cancels another.
  it.each(workflowsOnMergeGroup())("keys the concurrency group of %s on the ref", (file) => {
    const concurrency = readWorkflow(file).concurrency;

    expect(concurrency?.group, `${file} concurrency group`).toContain("github.ref");
    expect(String(concurrency?.["cancel-in-progress"]), `${file} cancel-in-progress`).not.toContain(
      "merge_group",
    );
  });
});
