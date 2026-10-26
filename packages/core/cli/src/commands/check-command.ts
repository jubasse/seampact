import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, printProblems, printWarnings } from "../cli-io.js";
import { NODE_CLI_PLAN_INPUTS, type PlanInputs } from "./app-plan.js";
import type { ConfigLocation } from "./config-location.js";
import { prepareRun } from "./run-preparation.js";
import { findWriteDrift } from "./write-drift.js";

// `seampact check`: plans and generates as `generate` does, in memory (the compatibility matrix at `checks.matrix`,
// every source compiled, a bundle source through the pinned-bundle check), then compares each file and document a
// run would write with the committed ones and writes nothing (ADR 0011 `checks`, ADR 0015).
export async function checkCommand(
  location: ConfigLocation,
  io: CliIo,
  inputs: PlanInputs = NODE_CLI_PLAN_INPUTS,
): Promise<number> {
  const prepared = await prepareRun(location, io, undefined, inputs);

  if (prepared.status === "refused") {
    printProblems(io, prepared.problems);

    return EXIT_REFUSED;
  }

  const drift = await findWriteDrift(prepared.value);

  printWarnings(io, drift.warnings);

  if (drift.errors.length > 0) {
    printProblems(io, drift.errors);

    return EXIT_REFUSED;
  }

  io.stdout("check: the generated files and documents match the committed ones.\n");

  return EXIT_SUCCESS;
}
