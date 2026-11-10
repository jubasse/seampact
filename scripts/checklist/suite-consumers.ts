// The consumer workflow that uploads each server target's http-suite reports: the release runs every one of them at
// its commit, and the release gate over the reports fails a server target that has no report.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { WORKFLOWS_DIR } from "./ci-jobs.ts";
import type { Problem } from "./model.ts";
import { SERVER_TARGETS } from "./targets.ts";

export const SUITE_CONSUMERS_FILE = "scripts/checklist/suite-consumers.ts";

/** The `workflow_dispatch` input a gate workflow may take: set on a release's run, it skips the drift rows. */
export const RELEASE_GATE_INPUT = "release-gate";

/** The workflow file, under .github/workflows, that runs the http suite of each server target the gate requires. */
export const SUITE_CONSUMERS: ReadonlyMap<string, string> = new Map([
  ["nestjs", "p5-nestjs.yml"],
  ["fastify", "p5-fastify-express.yml"],
  ["express", "p5-fastify-express.yml"],
  ["adonis", "p5-adonis.yml"],
  ["hono", "p5-hono.yml"],
  ["spring-boot", "p6-spring-boot.yml"],
  ["laravel", "p6-laravel.yml"],
  ["symfony", "p6-symfony.yml"],
  ["fastapi", "p7-fastapi.yml"],
  ["drf", "p7-drf.yml"],
  ["ninja", "p7-ninja.yml"],
  ["api-platform", "api-platform.yml"],
  ["nextjs", "nextjs.yml"],
]);

/** Each server target the gate requires without a consumer workflow, each entry outside them, each missing file. */
export function suiteConsumerProblems(
  root: string,
  suiteConsumers: ReadonlyMap<string, string>,
): Problem[] {
  const problems: Problem[] = [];
  const at = (message: string) => problems.push({ file: SUITE_CONSUMERS_FILE, message });

  for (const target of SERVER_TARGETS)
    if (!suiteConsumers.has(target))
      at(`server target ${target} has no consumer workflow: name the one that runs its http suite`);

  for (const [target, workflowFile] of suiteConsumers) {
    if (!SERVER_TARGETS.includes(target))
      at(`consumer workflow for ${target}, not a server target the release gate requires`);

    if (!existsSync(join(root, WORKFLOWS_DIR, workflowFile)))
      at(`consumer workflow of ${target} does not exist: ${workflowFile}`);
  }

  return problems;
}

/** Each consumer whose server target has no valid report among the fetched ones. */
export function missingReportProblems(
  suiteConsumers: ReadonlyMap<string, string>,
  reportTargets: ReadonlySet<string>,
): Problem[] {
  return [...suiteConsumers]
    .filter(([target]) => !reportTargets.has(target))
    .map(([target, workflowFile]) => ({
      file: SUITE_CONSUMERS_FILE,
      message: `release gate: no http-suite report for target ${target} (from a successful ${workflowFile} run)`,
    }));
}

/** The workflows the release runs at its commit for the gate: every consumer, then every workflow a proof cites. */
export function gateWorkflows(
  suiteConsumers: ReadonlyMap<string, string>,
  citedWorkflows: Iterable<string>,
): string[] {
  return [...new Set([...suiteConsumers.values(), ...citedWorkflows])].sort();
}
