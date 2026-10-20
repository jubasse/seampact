import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, printProblems } from "../cli-io.js";
import type { ConfigLocation } from "./config-location.js";
import { prepareRun } from "./run-preparation.js";
import { committableWrites, commitWrites } from "./write-plan.js";

// `seampact generate`: plans and generates everything in memory (an app's entries and documents, and a root's apps
// then its merged documents), then writes only when nothing was refused and every write's checks passed (ADR 0009,
// ADR 0011, ADR 0015).
export async function generateCommand(location: ConfigLocation, io: CliIo): Promise<number> {
  const prepared = await prepareRun(location, io);

  if (prepared.status === "refused") {
    printProblems(io, prepared.problems);

    return EXIT_REFUSED;
  }

  const writes = committableWrites(prepared.value);

  if (writes.status === "refused") {
    printProblems(io, writes.problems);

    return EXIT_REFUSED;
  }

  await commitWrites(writes.value, io);

  return EXIT_SUCCESS;
}
