import { readFileSync } from "node:fs";
import { join } from "node:path";
import { offeredValidatorPairs } from "@seampact/spec/compatibility";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT } from "../golden/repo-root.ts";

const WORKFLOWS_DIRECTORY = join(REPO_ROOT, ".github/workflows");

// The workflows that run a consumer per target, each job a matrix of `target` and `validators`.
const CONSUMER_WORKFLOWS = [
  "p5-nestjs.yml",
  "p5-fastify-express.yml",
  "p5-hono.yml",
  "p5-adonis.yml",
];

// The server target package and framework major each consumer target id tests, by its overlay under `targets/`.
const CONSUMER_TARGETS: Readonly<
  Record<string, { readonly target: string; readonly frameworkMajor: number }>
> = {
  nestjs: { target: "@seampact/codegen-nestjs", frameworkMajor: 12 },
  express: { target: "@seampact/codegen-express", frameworkMajor: 5 },
  express4: { target: "@seampact/codegen-express", frameworkMajor: 4 },
  fastify: { target: "@seampact/codegen-fastify", frameworkMajor: 5 },
  hono: { target: "@seampact/codegen-hono", frameworkMajor: 4 },
  adonis: { target: "@seampact/codegen-adonis", frameworkMajor: 7 },
  adonis6: { target: "@seampact/codegen-adonis", frameworkMajor: 6 },
};

interface ConsumerMatrix {
  readonly target: readonly string[];
  readonly validators: readonly string[];
}

interface WorkflowStep {
  readonly run?: string;
}

interface WorkflowJob {
  readonly strategy?: { readonly matrix: ConsumerMatrix };
  readonly steps?: readonly WorkflowStep[];
}

interface WorkflowDocument {
  readonly jobs: Readonly<Record<string, WorkflowJob>>;
}

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
  const consumerTarget = Object.hasOwn(CONSUMER_TARGETS, targetId)
    ? CONSUMER_TARGETS[targetId]
    : undefined;

  if (consumerTarget === undefined) {
    throw new Error(`consumers: workflow target '${targetId}' has no entry in CONSUMER_TARGETS.`);
  }

  return `${consumerTarget.target}@${consumerTarget.frameworkMajor}`;
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

function workflowPairKeys(file: string): string[] {
  const document: WorkflowDocument = parse(readFileSync(join(WORKFLOWS_DIRECTORY, file), "utf8"));

  return Object.entries(document.jobs).flatMap(([jobId, job]) => {
    const matrix = job.strategy?.matrix;

    if (matrix === undefined) {
      throw new Error(`consumers: ${file} job '${jobId}' has no strategy.matrix.`);
    }

    assertRunPassesEveryAxis(file, jobId, job);

    return matrix.target.flatMap((targetId) =>
      matrix.validators.map((validator) => {
        const targetKey = consumerTargetKey(targetId);

        return `${targetKey} ${validator}`;
      }),
    );
  });
}

describe("consumer workflows", () => {
  it("run every offered target, framework major and validator pair", () => {
    const workflowPairs = CONSUMER_WORKFLOWS.flatMap(workflowPairKeys).sort();
    const offeredPairs = offeredValidatorPairs()
      .map((pair) => pairKey(pair.target, pair.frameworkMajor, pair.validator))
      .sort();

    expect(workflowPairs).toEqual(offeredPairs);
  });
});
