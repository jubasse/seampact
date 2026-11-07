import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../golden/repo-root.ts";
import { readWorkflow, workflowFiles } from "./matrix-rows.ts";

const CI_WATCH_WORKFLOW = "ci-watch.yml";
const QUEUE_PULL_REQUEST_SCRIPT = join(REPO_ROOT, "scripts/ci/queue-pull-request.sh");
const GROUP_HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

function queuePullRequest(groupBranch: string): { status: number | null; output: string } {
  const run = spawnSync("bash", [QUEUE_PULL_REQUEST_SCRIPT, groupBranch], { encoding: "utf8" });

  return { status: run.status, output: `${run.stdout}${run.stderr}`.trim() };
}

function mergeGroupScript(): string {
  const job = readWorkflow(CI_WATCH_WORKFLOW).jobs["merge-group"];

  return (job?.steps ?? []).map((step) => step.run ?? "").join("\n");
}

// The events whose failed runs ci-watch reports: a push to develop (post-merge rows) and the nightly (drift rows).
const WATCHED_EVENTS = ["push", "schedule"];

function watchedWorkflowNames(): string[] {
  const trigger = readWorkflow(CI_WATCH_WORKFLOW).on.workflow_run;
  const workflows =
    typeof trigger === "object" && trigger !== null && "workflows" in trigger
      ? trigger.workflows
      : undefined;

  if (!Array.isArray(workflows) || !workflows.every((name) => typeof name === "string")) {
    throw new Error(`ci: ${CI_WATCH_WORKFLOW} has no workflow_run.workflows list of names.`);
  }

  return [...workflows].sort();
}

describe("ci-watch", () => {
  it("watches every workflow that runs on a push or the schedule", () => {
    const pushOrScheduleWorkflows = workflowFiles()
      .filter((file) => file !== CI_WATCH_WORKFLOW)
      .map(readWorkflow)
      .filter((document) => WATCHED_EVENTS.some((event) => event in document.on))
      .map((document) => document.name)
      .sort();

    expect(watchedWorkflowNames()).toEqual(pushOrScheduleWorkflows);
  });

  it("comments on the pull request a failed merge group names, and opens no issue", () => {
    const document = readWorkflow(CI_WATCH_WORKFLOW);

    expect(document.jobs["merge-group"]?.if).toContain(
      "github.event.workflow_run.event == 'merge_group'",
    );
    expect(document.jobs.report?.if).not.toContain("merge_group");
    expect(mergeGroupScript()).toContain('gh pr comment "$pull_request"');
    expect(mergeGroupScript()).not.toContain("gh issue");
  });

  it("reads the pull request number from the merge group branch", () => {
    expect(queuePullRequest(`gh-readonly-queue/develop/pr-364-${GROUP_HEAD_SHA}`)).toEqual({
      status: 0,
      output: "364",
    });
  });

  it("refuses a branch that names no pull request, and names it", () => {
    const refusal = queuePullRequest("feat/merge-queue");

    expect(refusal.status).toBe(1);
    expect(refusal.output).toContain("The merge group branch 'feat/merge-queue' is not");
  });
});
