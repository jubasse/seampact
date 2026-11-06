import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT } from "../golden/repo-root.ts";
import {
  matrixRows,
  readWorkflow,
  type WorkflowDocument,
  type WorkflowJob,
  type WorkflowStep,
  workflowFiles,
} from "./matrix-rows.ts";

const LANE_CHANGES_ACTION = "./.github/actions/lane-changes";
const LANE_AGGREGATE_ACTION = "./.github/actions/lane-aggregate";
const COMPILER_BINARY_ACTION = join(REPO_ROOT, ".github/actions/compiler-binary/action.yml");

// The suffixes of the jobs that hold the rows of a class other than the PR rows.
const CLASS_SUFFIXES = ["-queue", "-post-merge", "-drift"] as const;
// The changes outputs that hold a class, and the expression fragments of an output derived from one.
const CLASS_OUTPUTS = ["queue", "post-merge", "drift"] as const;
const SLOW_RUNNER_PATTERN = /windows|macos/;

// Each family's lanes, its representative first: the representative runs on every change to the family's shared
// code, the others on a pull request only for their own code.
const FAMILIES: Readonly<Record<string, readonly string[]>> = {
  "Node servers": [
    "p5-fastify-express.yml",
    "p5-nestjs.yml",
    "p5-hono.yml",
    "p5-adonis.yml",
    "validators-2.yml",
  ],
  fronts: ["p6-react.yml", "p6-vue.yml", "p6-angular.yml", "p4-msw.yml"],
  PHP: ["p6-laravel.yml", "p6-symfony.yml"],
  Python: ["p7-fastapi.yml", "p7-drf.yml", "p7-ninja.yml"],
};

// The fixtures the binary smoke apps read, on top of the compiler binary cache key's roots.
const BINARY_SMOKE_FIXTURES = ["^fixtures/reference/", "^fixtures/golden/pack-[^/]+/contract/"];

// Lanes whose paths were not narrowed run no nightly: the release's full run is the merge queue's or a manual one,
// and the docs site builds on every pull request it touches.
const LANES_WITHOUT_NIGHTLY = new Set(["docs-site.yml", "release.yml"]);

function laneChangesSteps(document: WorkflowDocument): WorkflowStep[] {
  return (document.jobs.changes?.steps ?? []).filter((step) => step.uses === LANE_CHANGES_ACTION);
}

function laneWorkflows(): string[] {
  return workflowFiles().filter((file) => laneChangesSteps(readWorkflow(file)).length > 0);
}

function pathLines(paths: string | undefined): string[] {
  return (paths ?? "").split("\n").filter((line) => line.trim() !== "");
}

function laneStep(file: string): WorkflowStep {
  const [step] = laneChangesSteps(readWorkflow(file));

  if (step === undefined) throw new Error(`ci: ${file} has no lane-changes step.`);

  return step;
}

function isAggregate(job: WorkflowJob): boolean {
  return (job.steps ?? []).some((step) => step.uses === LANE_AGGREGATE_ACTION);
}

// The changes outputs a job may read to run outside the fast tier: the class outputs and the outputs derived
// from one (a filtered queue row that a push also runs).
function outOfFastTierOutputs(document: WorkflowDocument): string[] {
  const outputs = document.jobs.changes?.outputs ?? {};

  return Object.entries(outputs)
    .filter(
      ([name, value]) =>
        CLASS_OUTPUTS.some((rowClass) => rowClass === name) ||
        CLASS_OUTPUTS.some((rowClass) => value.includes(`outputs.${rowClass} == 'true'`)),
    )
    .map(([name]) => name);
}

function runsOnPullRequest(document: WorkflowDocument, jobId: string, job: WorkflowJob): boolean {
  if (jobId === "changes" || isAggregate(job)) return false;
  if (CLASS_SUFFIXES.some((suffix) => jobId.endsWith(suffix))) return false;

  const condition = job.if ?? "";

  return !outOfFastTierOutputs(document).some((output) =>
    condition.includes(`needs.changes.outputs.${output} == 'true'`),
  );
}

function runnerLabels(job: WorkflowJob): string[] {
  const runsOn = job["runs-on"] ?? "";
  const matrixKey = /^\$\{\{ matrix\.([a-z-]+) \}\}$/.exec(runsOn)?.[1];
  const matrix = job.strategy?.matrix;

  if (matrixKey === undefined || matrix === undefined) return [runsOn];

  return matrixRows(matrix).map((row) => String(row[matrixKey]));
}

// The compiler binary cache key's hashFiles globs, without the negated ones.
function compilerBinaryKeyGlobs(): string[] {
  const action = parse(readFileSync(COMPILER_BINARY_ACTION, "utf8"));
  const hashStep = action.runs.steps.find(
    (step: WorkflowStep & { env?: Record<string, string> }) => step.env?.INPUTS_HASH !== undefined,
  );
  const globs = [...String(hashStep.env.INPUTS_HASH).matchAll(/'([^']+)'/g)].map(
    (match) => match[1] ?? "",
  );

  return globs.filter((glob) => !glob.startsWith("!"));
}

describe("the fast tier", () => {
  it.each(laneWorkflows())("in %s runs no PR row on a Windows or macOS runner", (file) => {
    const document = readWorkflow(file);

    for (const [jobId, job] of Object.entries(document.jobs)) {
      if (!runsOnPullRequest(document, jobId, job)) continue;

      for (const runner of runnerLabels(job)) {
        expect(runner, `${file} job '${jobId}'`).not.toMatch(SLOW_RUNNER_PATTERN);
      }
    }
  });

  it.each(laneWorkflows())("in %s runs each queue job under the queue output", (file) => {
    const document = readWorkflow(file);

    for (const [jobId, job] of Object.entries(document.jobs)) {
      if (!jobId.endsWith("-queue")) continue;

      expect(job.if, `${file} job '${jobId}'`).toContain("needs.changes.outputs.queue == 'true'");
    }
  });

  it("runs no release job on a pull request to develop", () => {
    const release = readWorkflow("release.yml");

    expect(release.jobs.changes?.outputs?.run).toBe(`\${{ steps.detect.outputs.queue }}`);
  });

  it.each(Object.entries(FAMILIES))(
    "names one representative of the %s, whose pull-request paths are its watched paths",
    (_family, files) => {
      const representatives = files.filter(
        (file) => pathLines(laneStep(file).with?.["pull-request-paths"]).length === 0,
      );

      expect(representatives).toEqual(files.slice(0, 1));
    },
  );
});

describe("the watched paths", () => {
  it("of p3-binary are the compiler binary cache key's roots and the smoke fixtures", () => {
    const watched = pathLines(laneStep("p3-binary.yml").with?.["watched-paths"]).map(
      (line) => new RegExp(line.trim()),
    );
    const keySamples = compilerBinaryKeyGlobs().map((glob) => glob.replace(/\*\*$/, "x.ts"));

    for (const sample of keySamples) {
      expect(
        watched.some((pattern) => pattern.test(sample)),
        `p3-binary watches ${sample}`,
      ).toBe(true);
    }

    const packageAndFixtureLines = pathLines(laneStep("p3-binary.yml").with?.["watched-paths"])
      .map((line) => line.trim())
      .filter((line) => line.startsWith("^packages/") || line.startsWith("^fixtures/"));
    const keyRootLines = packageAndFixtureLines.filter((line) => line.startsWith("^packages/"));

    expect(packageAndFixtureLines.filter((line) => line.startsWith("^fixtures/"))).toEqual(
      BINARY_SMOKE_FIXTURES,
    );

    for (const line of keyRootLines) {
      const pattern = new RegExp(line);

      expect(
        keySamples.some((sample) => pattern.test(sample)),
        `${line} is a cache key root`,
      ).toBe(true);
    }
  });

  it.each(laneWorkflows().filter((file) => !LANES_WITHOUT_NIGHTLY.has(file)))(
    "of %s have the nightly run as their net",
    (file) => {
      expect(Object.keys(readWorkflow(file).on)).toContain("schedule");
    },
  );
});
