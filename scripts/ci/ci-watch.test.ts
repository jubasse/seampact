import { describe, expect, it } from "vitest";
import { readWorkflow, workflowFiles } from "./matrix-rows.ts";

const CI_WATCH_WORKFLOW = "ci-watch.yml";

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
});
