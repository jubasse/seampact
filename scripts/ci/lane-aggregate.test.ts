import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../golden/repo-root.ts";

const AGGREGATE_SCRIPT = join(REPO_ROOT, ".github/actions/lane-aggregate/aggregate.sh");

type JobResult = "success" | "failure" | "cancelled" | "skipped";

interface NeededJob {
  readonly result: JobResult;
  readonly outputs?: Readonly<Record<string, string>>;
}

interface AggregateRun {
  readonly needs: Readonly<Record<string, NeededJob>>;
  readonly shouldRun: string;
  readonly allowSkip?: string;
}

const PULL_REQUEST_CLASSES = { "post-merge": "false", drift: "false" };
const SCHEDULE_CLASSES = { "post-merge": "true", drift: "true" };

function aggregate(run: AggregateRun): { status: number | null; output: string } {
  const result = spawnSync("bash", [AGGREGATE_SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      NEEDS_JSON: JSON.stringify(run.needs),
      SHOULD_RUN: run.shouldRun,
      ALLOW_SKIP: run.allowSkip ?? "",
    },
  });

  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("the lane aggregate", () => {
  it("passes when every needed job succeeded", () => {
    const verdict = aggregate({
      needs: { changes: { result: "success" }, build: { result: "success" } },
      shouldRun: "true",
    });

    expect(verdict.status).toBe(0);
  });

  it("passes a skipped job when the filter said skip", () => {
    const verdict = aggregate({
      needs: { changes: { result: "success" }, build: { result: "skipped" } },
      shouldRun: "false",
    });

    expect(verdict.status).toBe(0);
  });

  it("fails a skipped job when the filter said run", () => {
    const verdict = aggregate({
      needs: { changes: { result: "success" }, build: { result: "skipped" } },
      shouldRun: "true",
    });

    expect(verdict.status).toBe(1);
    expect(verdict.output).toContain("these jobs were skipped: build");
  });

  it("passes post-merge and drift jobs skipped on a pull request", () => {
    const verdict = aggregate({
      needs: {
        changes: { result: "success", outputs: PULL_REQUEST_CLASSES },
        smoke: { result: "success" },
        "smoke-post-merge": { result: "skipped" },
        "smoke-drift": { result: "skipped" },
      },
      shouldRun: "true",
    });

    expect(verdict.status).toBe(0);
  });

  it("fails a drift job skipped on the schedule", () => {
    const verdict = aggregate({
      needs: {
        changes: { result: "success", outputs: SCHEDULE_CLASSES },
        smoke: { result: "success" },
        "smoke-drift": { result: "skipped" },
      },
      shouldRun: "true",
    });

    expect(verdict.status).toBe(1);
    expect(verdict.output).toContain("these jobs were skipped: smoke-drift");
  });

  it("fails a class job when the changes job gives no output for its class", () => {
    const verdict = aggregate({
      needs: { changes: { result: "success" }, "split-drift": { result: "skipped" } },
      shouldRun: "true",
    });

    expect(verdict.status).toBe(1);
    expect(verdict.output).toContain("the changes job gives no 'drift' output");
  });

  it("passes a skip that allow-skip names, and only that one", () => {
    const needs = {
      changes: { result: "success" },
      "sign-macos": { result: "skipped" },
      manifest: { result: "skipped" },
    } as const;

    expect(aggregate({ needs, shouldRun: "true", allowSkip: "sign-macos manifest" }).status).toBe(
      0,
    );

    const verdict = aggregate({ needs, shouldRun: "true", allowSkip: "sign-macos" });

    expect(verdict.status).toBe(1);
    expect(verdict.output).toContain("these jobs were skipped: manifest");
  });

  it("fails a job allow-skip names when it failed", () => {
    const verdict = aggregate({
      needs: { changes: { result: "success" }, "sign-macos": { result: "failure" } },
      shouldRun: "true",
      allowSkip: "sign-macos",
    });

    expect(verdict.status).toBe(1);
    expect(verdict.output).toContain("A needed job failed or was cancelled: sign-macos=failure");
  });

  it("refuses an allow-skip name the aggregate does not need", () => {
    const verdict = aggregate({
      needs: { changes: { result: "success" } },
      shouldRun: "true",
      allowSkip: "sign-mac",
    });

    expect(verdict.status).toBe(1);
    expect(verdict.output).toContain(
      "allow-skip names 'sign-mac', which the aggregate does not need",
    );
  });

  it("fails when the filter gave no answer", () => {
    const verdict = aggregate({ needs: { changes: { result: "success" } }, shouldRun: "" });

    expect(verdict.status).toBe(1);
    expect(verdict.output).toContain("the change filter gave no answer");
  });
});
