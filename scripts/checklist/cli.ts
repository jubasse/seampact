import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { check } from "./check.ts";
import { loadModel } from "./load.ts";
import type { Problem } from "./model.ts";
import { formatProblem } from "./model.ts";
import { loadResults, renderReport } from "./report.ts";

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
    },
  });
  const command = positionals[0] ?? "check";
  const root = resolve(values.root ?? REPO_ROOT);

  if (command === "check") {
    const problems = check({
      root,
      ...(values.base === undefined ? {} : { base: values.base }),
      ...(values.consumers === undefined ? {} : { consumers: resolve(values.consumers) }),
      releaseGate: values["release-gate"] === true,
    });

    for (const p of problems) console.error(formatProblem(p));
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

  console.error(`unknown command "${command}" (check | report)`);

  return 2;
}

process.exitCode = main(process.argv.slice(2));
