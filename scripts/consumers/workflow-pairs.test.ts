import { offeredValidatorPairs } from "@seampact/spec/compatibility";
import { describe, expect, it } from "vitest";
import { matrixRows, readWorkflow, type WorkflowJob } from "../ci/matrix-rows.ts";

// The workflows that run a consumer per target, each job a matrix whose rows hold a `target` and a `validators`;
// the PR rows and the post-merge rows of a workflow together run every pair.
const CONSUMER_WORKFLOWS = [
  "p5-nestjs.yml",
  "p5-fastify-express.yml",
  "p5-hono.yml",
  "p5-adonis.yml",
  "validators-2.yml",
];

// The jobs of a consumer workflow that run no consumer: the lane's change filter and its required check.
const LANE_FILTER_AND_CHECK_JOBS: ReadonlySet<string> = new Set(["changes", "own-validators"]);

// The workflows that run a front consumer: not a server pair, so only the matrix axes are checked.
const FRONT_CONSUMER_WORKFLOWS = ["p6-react.yml", "p6-vue.yml", "p6-angular.yml", "p4-msw.yml"];

// The server target package and framework major each consumer target id tests, from the matrix's tested majors.
const CONSUMER_TARGETS: ReadonlyMap<string, string> = new Map(
  offeredValidatorPairs().map((pair) => [pair.consumer, `${pair.target}@${pair.frameworkMajor}`]),
);

// The consumers that run their base consumer's pair in another module format, with the base they stand for.
const MODULE_FORMAT_VARIANTS: ReadonlyMap<string, string> = new Map([["nestjs-cjs", "nestjs"]]);

// The consumer run must pass each matrix axis, or that axis is dead: the job would test one value of it.
const CONSUMER_RUN_ARGUMENTS = [
  `--target "\${{ matrix.target }}"`,
  `--validators "\${{ matrix.validators }}"`,
];

// The key both sides compare: the server target package and framework major, then the validator provider id.
function pairKey(target: string, frameworkMajor: number, validator: string): string {
  return `${target}@${frameworkMajor} ${validator}`;
}

function consumerTargetKey(targetId: string): string {
  const consumerTarget = CONSUMER_TARGETS.get(MODULE_FORMAT_VARIANTS.get(targetId) ?? targetId);

  if (consumerTarget === undefined) {
    throw new Error(
      `consumers: workflow target '${targetId}' is no consumer the compatibility matrix records.`,
    );
  }

  return consumerTarget;
}

function assertRunPassesEveryAxis(file: string, jobId: string, job: WorkflowJob): void {
  const consumerRun = job.steps?.find((step) =>
    step.run?.includes("scripts/consumers/cli.ts"),
  )?.run;

  if (consumerRun === undefined) {
    throw new Error(
      `consumers: ${file} job '${jobId}' has no step running scripts/consumers/cli.ts.`,
    );
  }

  for (const argument of CONSUMER_RUN_ARGUMENTS) {
    if (!consumerRun.includes(argument)) {
      throw new Error(`consumers: ${file} job '${jobId}' run step does not pass ${argument}.`);
    }
  }
}

function workflowTargetIds(file: string): string[] {
  return consumerJobsOf(file).flatMap(([, job]) =>
    matrixRows(job.strategy?.matrix ?? {}).map((row) => String(row.target)),
  );
}

function consumerJobsOf(file: string): [string, WorkflowJob][] {
  const document = readWorkflow(file);

  return Object.entries(document.jobs).filter(([jobId]) => !LANE_FILTER_AND_CHECK_JOBS.has(jobId));
}

function workflowPairKeys(file: string): string[] {
  return consumerJobsOf(file).flatMap(([jobId, job]) => {
    const matrix = job.strategy?.matrix;

    if (matrix === undefined) {
      throw new Error(`consumers: ${file} job '${jobId}' has no strategy.matrix.`);
    }

    assertRunPassesEveryAxis(file, jobId, job);

    return matrixRows(matrix).map((row) => {
      const { target, validators } = row;

      if (typeof target !== "string" || typeof validators !== "string") {
        throw new Error(
          `consumers: ${file} job '${jobId}' has a row without a target or validators.`,
        );
      }

      return `${consumerTargetKey(target)} ${validators}`;
    });
  });
}

describe("consumer workflows", () => {
  it("run every offered target, framework major and validator pair", () => {
    // A pair may run twice with another target option (the NestJS reply), so pairs compare as a set.
    const workflowPairs = [...new Set(CONSUMER_WORKFLOWS.flatMap(workflowPairKeys))].sort();
    const offeredPairs = offeredValidatorPairs()
      .map((pair) => pairKey(pair.target, pair.frameworkMajor, pair.validator))
      .sort();

    expect(workflowPairs).toEqual(offeredPairs);
  });

  it("run every module format variant of a consumer", () => {
    const workflowTargets = new Set(CONSUMER_WORKFLOWS.flatMap(workflowTargetIds));

    expect(
      [...MODULE_FORMAT_VARIANTS.keys()].filter((variant) => !workflowTargets.has(variant)),
    ).toEqual([]);
  });
});

describe("front consumer workflows", () => {
  it("pass both matrix axes to the consumer run", () => {
    for (const file of FRONT_CONSUMER_WORKFLOWS) {
      const document = readWorkflow(file);

      for (const [jobId, job] of Object.entries(document.jobs)) {
        if (job.strategy?.matrix !== undefined) assertRunPassesEveryAxis(file, jobId, job);
      }
    }
  });
});
