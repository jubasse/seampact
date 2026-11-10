import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { check } from "./check.ts";
import { ciJobLine, dispatchInputsOf, matchesEveryJob, workflowJobs } from "./ci-jobs.ts";
import { loadModel } from "./load.ts";
import type { Problem } from "./model.ts";
import { formatProblem } from "./model.ts";
import { DECLARED_DEFERRALS, ITEMS_DEFERRED, itemsDeferredLines } from "./release-scope.ts";
import { loadResults, renderReport } from "./report.ts";
import { gateWorkflows, RELEASE_GATE_INPUT, SUITE_CONSUMERS } from "./suite-consumers.ts";
import { VARIANT_ROW_SETS } from "./variant-rows.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      base: { type: "string" },
      consumers: { type: "string" },
      results: { type: "string" },
      "release-gate": { type: "boolean" },
      "suite-reports": { type: "string" },
    },
  });
  const command = positionals[0] ?? "check";
  const root = resolve(values.root ?? REPO_ROOT);
  // The release policy tables name the repository's own ids: a `--root` fixture checklist goes without them.
  const releasePolicy =
    values.root === undefined
      ? {
          itemsDeferred: ITEMS_DEFERRED,
          declaredDeferrals: DECLARED_DEFERRALS,
          variantRowSets: VARIANT_ROW_SETS,
          suiteConsumers: SUITE_CONSUMERS,
        }
      : {};

  if (command === "check") {
    const suiteReports = values["suite-reports"];

    if (suiteReports !== undefined && values["release-gate"] !== true) {
      console.error("--suite-reports reads proofs for the release gate only: add --release-gate");

      return 2;
    }

    const releaseGate = values["release-gate"] === true;
    const problems = check({
      root,
      ...releasePolicy,
      ...(values.base === undefined ? {} : { base: values.base }),
      ...(values.consumers === undefined ? {} : { consumers: resolve(values.consumers) }),
      releaseGate,
      ...(suiteReports === undefined ? {} : { suiteReports: resolve(suiteReports) }),
    });

    for (const p of problems) console.error(formatProblem(p));

    if (releaseGate) {
      for (const line of itemsDeferredLines(releasePolicy.itemsDeferred ?? new Map()))
        console.error(line);
    }

    console.error(
      problems.length === 0 ? "checklist: ok" : `checklist: ${problems.length} problem(s)`,
    );

    return problems.length === 0 ? 0 : 1;
  }

  if (command === "report") {
    const problems: Problem[] = [];
    const model = loadModel(root, problems);

    if (problems.length > 0) {
      for (const p of problems) console.error(formatProblem(p));

      return 1;
    }

    const results = values.results === undefined ? undefined : loadResults(values.results);

    process.stdout.write(renderReport(model, root, results));

    return 0;
  }

  if (command === "ci-jobs") return printCiJobs(root);

  if (command === "gate-workflows")
    return printGateWorkflows(root, releasePolicy.suiteConsumers ?? new Map());

  console.error(`unknown command "${command}" (check | report | ci-jobs | gate-workflows)`);

  return 2;
}

/** One line per CI job the proof files cite, for the fetcher (ci-jobs.ts, `ciJobLine`). */
function printCiJobs(root: string): number {
  const problems: Problem[] = [];
  const model = loadModel(root, problems);
  const lines = new Set<string>();

  for (const ref of model.proofs.flatMap((p) => p.tests).filter((t) => t.kind === "ci")) {
    const match = workflowJobs(root, ref.path)?.get(ref.name);

    if (match === undefined)
      problems.push({ file: ref.path, message: `CI job does not exist: ${ref.name}` });
    else if (matchesEveryJob(match))
      problems.push({
        file: ref.path,
        message: `CI job name starts with an expression: ${ref.name} (it would match every job of a run)`,
      });
    else lines.add(ciJobLine(ref, match));
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(formatProblem(p));

    return 1;
  }

  for (const line of [...lines].sort()) process.stdout.write(`${line}\n`);

  return 0;
}

/**
 * One line per workflow the release runs at its commit before the gate reads that commit's results: each consumer
 * workflow and each workflow a proof file cites (`ci:`); each needs a `workflow_dispatch` trigger. A workflow whose
 * trigger takes the `release-gate` input is followed by it, tab-separated: the release passes it to skip the drift
 * rows. A `--root` fixture checklist has no consumer workflows.
 */
function printGateWorkflows(root: string, suiteConsumers: ReadonlyMap<string, string>): number {
  const problems: Problem[] = [];
  const model = loadModel(root, problems);

  if (problems.length > 0) {
    for (const p of problems) console.error(formatProblem(p));

    return 1;
  }

  const citedWorkflows = model.proofs
    .flatMap((p) => p.tests)
    .filter((t) => t.kind === "ci")
    .map((t) => t.path);

  const lines: string[] = [];
  let notDispatchable = 0;

  for (const workflow of gateWorkflows(suiteConsumers, citedWorkflows)) {
    const inputs = dispatchInputsOf(root, workflow);

    if (inputs === undefined) {
      console.error(
        `${workflow}: the release cannot start it at its commit: add a workflow_dispatch trigger`,
      );
      notDispatchable++;
    } else
      lines.push(
        inputs.includes(RELEASE_GATE_INPUT) ? `${workflow}\t${RELEASE_GATE_INPUT}` : workflow,
      );
  }

  if (notDispatchable > 0) return 1;

  for (const line of lines) process.stdout.write(`${line}\n`);

  return 0;
}

process.exitCode = main(process.argv.slice(2));
