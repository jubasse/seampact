import { resolve } from "node:path";
import { diffContractSets, formatDiffReport } from "@seampact/diff";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, printProblems } from "../cli-io.js";
import type { CliProblem } from "../cli-problem.js";
import { openApiApiNames, readAppConfig } from "../config/index.js";
import { addQualifyFix, entryApiRefs, usedSources } from "./api-refs.js";
import { compileSources } from "./compile-sources.js";
import type { ConfigLocation } from "./config-location.js";
import { readBaseline } from "./diff-baseline.js";

const TODAY_LENGTH = "YYYY-MM-DD".length;

// `seampact diff --against <path>`: compiles the sources the app config's targets use and classifies each api's
// changes against the baseline IRs (FR-13), with the app config's `diff.gate` and `diff.exempt`. Exit code 1 when
// a diff is refused or the gate fails.
export async function diffCommand(
  location: ConfigLocation,
  against: string,
  io: CliIo,
): Promise<number> {
  const read = await readAppConfig(location.file, location.displayName);

  if (read.status === "refused") return refuse(io, read.problems);

  const { config } = read;
  const extraRefs = openApiApiNames(config);
  const used = await usedSources(config, extraRefs);

  if (used.status === "refused") return refuse(io, used.problems);

  if (used.names.length === 0) {
    return refuse(io, [
      {
        code: "diff.no-api",
        message: "The app config names no api, so there is nothing to compare.",
        fix: "Name an api in a target entry's `api` or `apis`, or in `openapi`.",
      },
    ]);
  }

  const baseline = await readBaseline(resolve(io.cwd, against));

  if (baseline.status === "refused") return refuse(io, baseline.problems);

  const compiled = await compileSources(config, used.names, io);

  if (compiled.failed) {
    return refuse(io, addQualifyFix(compiled.problems, [...entryApiRefs(config), ...extraRefs]));
  }

  const results = diffContractSets(
    baseline.value,
    new Map(compiled.apis.map(({ api, ir }) => [api, ir])),
    {
      today: io.today?.() ?? new Date().toISOString().slice(0, TODAY_LENGTH),
      ...(config.diff?.gate === undefined ? {} : { gate: config.diff.gate }),
      ...(config.diff?.exempt === undefined ? {} : { exempt: config.diff.exempt }),
    },
  );
  let failed = false;

  for (const result of results.values()) {
    io.stdout(formatDiffReport(result));

    if (!result.ok || !result.gate.passed) failed = true;
  }

  return failed ? EXIT_REFUSED : EXIT_SUCCESS;
}

function refuse(io: CliIo, problems: readonly CliProblem[]): number {
  printProblems(io, problems);

  return EXIT_REFUSED;
}
