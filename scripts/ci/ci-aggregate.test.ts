import { describe, expect, it } from "vitest";
import { readWorkflow } from "./matrix-rows.ts";

const LANE_AGGREGATE_ACTION = "./.github/actions/lane-aggregate";
const CI_WORKFLOW = "ci.yml";
const REQUIRED_CHECK_JOB = "ci";

describe("the ci required check", () => {
  const jobs = readWorkflow(CI_WORKFLOW).jobs;
  const requiredJob = jobs[REQUIRED_CHECK_JOB];

  it("runs even when a needed job failed, or a skipped check would pass", () => {
    expect(requiredJob?.if).toBe("always()");
  });

  it("needs every other job of the workflow", () => {
    const otherJobs = Object.keys(jobs).filter((jobId) => jobId !== REQUIRED_CHECK_JOB);

    expect([...(requiredJob?.needs ?? [])].sort()).toEqual(otherJobs.sort());
  });

  it("fails on a needed job's failure before the merge and the floors", () => {
    const steps = requiredJob?.steps ?? [];
    const aggregateIndex = steps.findIndex((step) => step.uses === LANE_AGGREGATE_ACTION);
    const mergeIndex = steps.findIndex((step) => step.run?.includes("--merge-reports"));

    expect(aggregateIndex).toBeGreaterThanOrEqual(0);
    expect(aggregateIndex).toBeLessThan(mergeIndex);
  });
});
