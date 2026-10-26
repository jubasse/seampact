import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../golden/repo-root.ts";
import {
  type MatrixRow,
  matrixRows,
  readWorkflow,
  rowLabel,
  type WorkflowDocument,
  type WorkflowJob,
  workflowFiles,
} from "./matrix-rows.ts";

const ROW_CLASSES_SCRIPT = join(REPO_ROOT, ".github/actions/lane-changes/row-classes.sh");
const LANE_AGGREGATE_ACTION = "./.github/actions/lane-aggregate";

// The suffix of a job that holds the rows of a class; a job without one holds the PR rows.
const ROW_CLASS_SUFFIXES = ["post-merge", "drift"] as const;

// The Spring Boot consumer rows: each build row has its http-suite row.
const SPRING_CONSUMER_PR_ROWS: readonly MatrixRow[] = [
  { "build-tool": "gradle", jdk: 21, contract: "bundle" },
  { "build-tool": "maven", jdk: 25, contract: "bundle" },
];
const SPRING_CONSUMER_POST_MERGE_ROWS: readonly MatrixRow[] = [
  { "build-tool": "gradle", jdk: 25, contract: "bundle" },
  { "build-tool": "maven", jdk: 21, contract: "bundle" },
  { "build-tool": "gradle", jdk: 25, contract: "local-yaml" },
  { "build-tool": "maven", jdk: 25, contract: "local-yaml" },
];

// The rows of each job split by class, as the CI policy's final table places them. A row moves between classes
// only on its failure history: it fails here until the table moves with it.
const ROWS_BY_JOB: Readonly<Record<string, Readonly<Record<string, readonly MatrixRow[]>>>> = {
  "p2-golden.yml": {
    determinism: [
      { os: "ubuntu-latest", tz: "Pacific/Kiritimati", lang: "tr_TR.UTF-8" },
      { os: "windows-latest", tz: "Pacific/Auckland", lang: "tr_TR.UTF-8" },
    ],
    "determinism-post-merge": [
      { os: "ubuntu-latest", tz: "UTC", lang: "en_US.UTF-8" },
      { os: "windows-latest", tz: "UTC", lang: "en_US.UTF-8" },
    ],
    "determinism-drift": [
      { os: "macos-latest", tz: "America/Los_Angeles", lang: "en_US.UTF-8" },
      { os: "macos-latest", tz: "Asia/Kolkata", lang: "tr_TR.UTF-8" },
    ],
  },
  "p3-dist.yml": {
    tarball: [
      { os: "ubuntu-latest", tz: "UTC", lang: "en_US.UTF-8" },
      { os: "windows-latest", tz: "Pacific/Auckland", lang: "en_US.UTF-8" },
    ],
    "tarball-drift": [{ os: "macos-latest", tz: "Asia/Kolkata", lang: "tr_TR.UTF-8" }],
  },
  "p3-binary.yml": {
    smoke: [
      { id: "linux-x64", runner: "ubuntu-24.04", binary: "seampact-linux-x64" },
      { id: "win32-x64", runner: "windows-2025", binary: "seampact-win32-x64.exe" },
    ],
    "smoke-post-merge": [
      { id: "linux-arm64", runner: "ubuntu-24.04-arm", binary: "seampact-linux-arm64" },
    ],
    "smoke-drift": [
      { id: "darwin-arm64", runner: "macos-15", binary: "seampact-darwin-arm64" },
      { id: "darwin-x64", runner: "macos-15-intel", binary: "seampact-darwin-x64" },
    ],
  },
  "p6-jvm-plugins.yml": {
    "gradle-plugin": [
      { "test-jdk": 21, "test-gradle": "8.14" },
      { "test-jdk": 25, "test-gradle": "wrapper" },
    ],
    "gradle-plugin-post-merge": [{ "test-jdk": 21, "test-gradle": "wrapper" }],
    "maven-plugin": [
      { "test-jdk": 21, "test-maven": "3.9.16" },
      { "test-jdk": 25, "test-maven": "3.9.16" },
    ],
    "maven-plugin-drift": [
      { "test-jdk": 21, "test-maven": "4.0.0-rc-7" },
      { "test-jdk": 25, "test-maven": "4.0.0-rc-7" },
    ],
  },
  "p6-spring-boot.yml": {
    build: SPRING_CONSUMER_PR_ROWS,
    "build-post-merge": SPRING_CONSUMER_POST_MERGE_ROWS,
    "http-suite": SPRING_CONSUMER_PR_ROWS,
    "http-suite-post-merge": SPRING_CONSUMER_POST_MERGE_ROWS,
  },
  "p6-php-core.yml": {
    split: [{ "php-version": "8.3" }],
    "split-drift": [{ "php-version": "8.5" }],
  },
  "p5-adonis.yml": {
    "adonis-consumer": [
      { target: "adonis", validators: "zod" },
      { target: "adonis6", validators: "yup" },
    ],
    "adonis-consumer-post-merge": [
      { target: "adonis", validators: "yup" },
      { target: "adonis6", validators: "zod" },
    ],
  },
  "p5-fastify-express.yml": {
    consumer: [
      { target: "express", validators: "zod" },
      { target: "express4", validators: "yup" },
      { target: "fastify", validators: "zod" },
    ],
    "consumer-post-merge": [
      { target: "express", validators: "yup" },
      { target: "express4", validators: "zod" },
      { target: "fastify", validators: "yup" },
    ],
  },
  "p5-hono.yml": {
    consumer: [{ target: "hono", validators: "zod" }],
    "consumer-post-merge": [{ target: "hono", validators: "yup" }],
  },
  "p5-nestjs.yml": {
    "nestjs-consumer": [
      { target: "nestjs", validators: "class-validator", reply: "handler" },
      { target: "nestjs", validators: "zod", reply: "interceptor" },
    ],
    "nestjs-consumer-post-merge": [
      { target: "nestjs", validators: "zod", reply: "handler" },
      { target: "nestjs", validators: "yup", reply: "handler" },
    ],
  },
};

function jobRowLabels(job: WorkflowJob): string[] {
  const matrix = job.strategy?.matrix;

  return matrix === undefined ? [] : matrixRows(matrix).map(rowLabel).sort();
}

function neededJobs(job: WorkflowJob): readonly string[] {
  if (job.needs === undefined) return [];

  return typeof job.needs === "string" ? [job.needs] : job.needs;
}

function rowClassOf(jobId: string): (typeof ROW_CLASS_SUFFIXES)[number] | undefined {
  return ROW_CLASS_SUFFIXES.find((rowClass) => jobId.endsWith(`-${rowClass}`));
}

function aggregateJobs(document: WorkflowDocument): [string, WorkflowJob][] {
  return Object.entries(document.jobs).filter(([, job]) =>
    (job.steps ?? []).some((step) => step.uses === LANE_AGGREGATE_ACTION),
  );
}

function rowClassesFor(event: string, laneRun: string): { status: number | null; output: string } {
  const run = spawnSync("bash", [ROW_CLASSES_SCRIPT, event, laneRun], { encoding: "utf8" });

  return { status: run.status, output: `${run.stdout}${run.stderr}`.trim() };
}

describe("the row classes of an event", () => {
  it.each([
    ["pull_request", "post-merge=false\ndrift=false"],
    ["push", "post-merge=true\ndrift=false"],
    ["schedule", "post-merge=true\ndrift=true"],
    ["workflow_dispatch", "post-merge=true\ndrift=true"],
    ["release", "post-merge=true\ndrift=true"],
  ])("on %s", (event, expectedClasses) => {
    expect(rowClassesFor(event, "true")).toEqual({ status: 0, output: expectedClasses });
  });

  it("holds no class when the lane has nothing to test", () => {
    expect(rowClassesFor("schedule", "false")).toEqual({
      status: 0,
      output: "post-merge=false\ndrift=false",
    });
  });

  it("refuses an event no class is defined for", () => {
    const refusal = rowClassesFor("merge_group", "true");

    expect(refusal.status).toBe(1);
    expect(refusal.output).toContain("No row class is defined for the 'merge_group' event");
  });
});

describe("the rows of each class", () => {
  it.each(Object.entries(ROWS_BY_JOB))("in %s match the CI policy table", (file, rowsByJob) => {
    const document = readWorkflow(file);
    const splitJobIds = Object.keys(document.jobs).filter((jobId) => jobId in rowsByJob);

    expect(splitJobIds.sort()).toEqual(Object.keys(rowsByJob).sort());

    for (const [jobId, expectedRows] of Object.entries(rowsByJob)) {
      const job = document.jobs[jobId];

      expect(job, `${file} job '${jobId}'`).toBeDefined();

      if (job === undefined) continue;

      expect(jobRowLabels(job), `${file} job '${jobId}'`).toEqual(
        expectedRows.map(rowLabel).sort(),
      );
    }
  });

  it.each(workflowFiles())("in %s run the PR job's steps under the class's output", (file) => {
    const document = readWorkflow(file);

    for (const [jobId, job] of Object.entries(document.jobs)) {
      const rowClass = rowClassOf(jobId);

      if (rowClass === undefined) continue;

      const prJob = document.jobs[jobId.slice(0, -`-${rowClass}`.length)];

      expect(prJob, `${file} job '${jobId}' has no PR job`).toBeDefined();
      expect(isDeepStrictEqual(job.steps, prJob?.steps), `${file} job '${jobId}' steps`).toBe(true);
      expect(job.name, `${file} job '${jobId}' name`).toBe(prJob?.name);
      expect(job.if, `${file} job '${jobId}' if`).toContain(
        `needs.changes.outputs.${rowClass} == 'true'`,
      );
      expect(
        document.jobs.changes?.outputs?.[rowClass],
        `${file} changes job output '${rowClass}'`,
      ).toBe(`\${{ steps.detect.outputs.${rowClass} }}`);
    }
  });

  it.each(workflowFiles())("in %s all reach the aggregate of their PR job", (file) => {
    const document = readWorkflow(file);

    for (const [aggregateId, aggregate] of aggregateJobs(document)) {
      const needed = new Set(neededJobs(aggregate));

      for (const jobId of Object.keys(document.jobs)) {
        const rowClass = rowClassOf(jobId);

        if (rowClass === undefined) continue;

        const prJobId = jobId.slice(0, -`-${rowClass}`.length);

        if (!needed.has(prJobId)) continue;

        expect(needed.has(jobId), `${file} aggregate '${aggregateId}' needs '${jobId}'`).toBe(true);
      }
    }
  });
});
