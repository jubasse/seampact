import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { check } from "./check.ts";
import { ciJobLine, startsWithExpression, workflowJobs } from "./ci-jobs.ts";
import { loadModel } from "./load.ts";
import type { Problem } from "./model.ts";
import { formatProblem } from "./model.ts";
import { ITEMS_AFTER_1_0, itemsAfter1_0Lines } from "./release-scope.ts";
import { loadResults, renderReport } from "./report.ts";
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
      ? { itemsAfter1_0: ITEMS_AFTER_1_0, variantRowSets: VARIANT_ROW_SETS }
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
      for (const line of itemsAfter1_0Lines(releasePolicy.itemsAfter1_0 ?? new Map()))
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

  console.error(`unknown command "${command}" (check | report | ci-jobs)`);

  return 2;
}

/** One line per CI job the proof files cite, for the fetcher (ci-jobs.ts, `ciJobLine`). */
function printCiJobs(root: string): number {
  const problems: Problem[] = [];
  const model = loadModel(root, problems);
  const lines = new Set<string>();

  for (const ref of model.proofs.flatMap((p) => p.tests).filter((t) => t.kind === "ci")) {
    const displayName = workflowJobs(root, ref.path)?.get(ref.name);

    if (displayName === undefined)
      problems.push({ file: ref.path, message: `CI job does not exist: ${ref.name}` });
    else if (startsWithExpression(displayName))
      problems.push({
        file: ref.path,
        message: `CI job name starts with an expression: ${ref.name} (it would match every job of a run)`,
      });
    else lines.add(ciJobLine(ref, displayName));
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(formatProblem(p));

    return 1;
  }

  for (const line of [...lines].sort()) process.stdout.write(`${line}\n`);

  return 0;
}

process.exitCode = main(process.argv.slice(2));
