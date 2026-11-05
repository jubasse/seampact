import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { removeConfigTrees, writeConfigTree } from "./config-test-tree.test-support.js";
import { readAppConfig } from "./read-app-config.js";

// The shared `out` vectors (`packages/core/spec/vectors/config/out-directories.json`), which the JVM, PHP and
// Python readers prove themselves on too.
interface OutDirectoryVectors {
  cases: { case: string; outs: string[]; codes: string[] }[];
}

const VECTORS: OutDirectoryVectors = JSON.parse(
  readFileSync(
    new URL("../../../spec/vectors/config/out-directories.json", import.meta.url),
    "utf8",
  ),
);

async function readEntriesWithOuts(outs: readonly string[]) {
  const entries = outs.map(
    (out, index) =>
      `  - { id: entry${index}, use: '@seampact/codegen-express', api: a, out: '${out}' }\n`,
  );
  const directory = writeConfigTree({ "seampact.config.yaml": `targets:\n${entries.join("")}` });

  try {
    return await readAppConfig(`${directory}/seampact.config.yaml`, "seampact.config.yaml");
  } finally {
    removeConfigTrees();
  }
}

describe("the out directories of two target entries", () => {
  test.each(VECTORS.cases)("$case: $outs", async ({ outs, codes }) => {
    const outcome = await readEntriesWithOuts(outs);
    const refusedCodes =
      outcome.status === "refused" ? outcome.problems.map(({ code }) => code) : [];

    expect(refusedCodes).toEqual(codes);
  });
});
