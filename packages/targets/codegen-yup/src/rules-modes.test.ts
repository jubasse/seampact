import { readFileSync } from "node:fs";
import type { ContractIR } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { target } from "./index.js";

const GOLDEN_IRS = ["tasks", "tasksService"];
const RULES_MODES = ["native", "seampact-consistent"];

function readGoldenIr(name: string): ContractIR {
  return JSON.parse(
    readFileSync(
      new URL(`../../../../fixtures/golden/reference/${name}.ir.json`, import.meta.url),
      "utf8",
    ),
  );
}

// Every generated file of each rules mode, kept as a reviewed snapshot: `seampact-consistent` is the output from
// before the option existed, byte for byte.
test.each(RULES_MODES.flatMap((rules) => GOLDEN_IRS.map((name) => [rules, name])))(
  "the %s validators of %s match their snapshot",
  async (rules, name) => {
    const outcome = await target.generate({
      ir: readGoldenIr(name),
      options: { rules },
      links: {},
      artefacts: new Set(["validators"]),
    });

    if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

    for (const file of outcome.files) {
      await expect(file.contents).toMatchFileSnapshot(
        `../rules-snapshots/${rules}/${name}/${file.path}.snap`,
      );
    }
  },
);
