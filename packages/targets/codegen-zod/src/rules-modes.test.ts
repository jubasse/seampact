import { readFileSync } from "node:fs";
import type { ContractIR } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { target } from "./index.js";

const GOLDEN_IR = new URL("../../../../fixtures/golden/reference/tasks.ir.json", import.meta.url);
const RULES_MODES = ["native", "seampact-consistent"];

// Every generated file of each rules mode, kept as a reviewed snapshot: the validators of `seampact-consistent` are
// the output from before the option existed.
test.each(RULES_MODES)(
  "the %s validators of the reference contract match their snapshot",
  async (rules) => {
    const ir: ContractIR = JSON.parse(readFileSync(GOLDEN_IR, "utf8"));
    const outcome = await target.generate({
      ir,
      options: { rules },
      links: {},
      artefacts: new Set(["validators"]),
    });

    if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

    for (const file of outcome.files) {
      await expect(file.contents).toMatchFileSnapshot(
        `../rules-snapshots/${rules}/${file.path}.snap`,
      );
    }
  },
);
