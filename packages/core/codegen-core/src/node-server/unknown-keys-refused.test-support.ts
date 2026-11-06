import { readFileSync } from "node:fs";
import type { ContractIR } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import type { Target } from "../target.js";

// The unknown keys policies the validators targets do not generate in 1.0: an operation input that ignores or keeps
// them is refused by name, so the item stays on the refusal and not on a policy the validators would silently drop.

const AGREEMENT_IR = new URL(
  "../../../../../fixtures/golden/agreement/agreement.ir.json",
  import.meta.url,
);

/** Registers the refusal test of the unknown keys policies for one validators target. */
export function describeUnknownKeysRefusals(target: Target): void {
  test("an operation input that ignores or keeps its unknown keys is refused by name", async () => {
    const ir: ContractIR = JSON.parse(readFileSync(AGREEMENT_IR, "utf8"));
    const outcome = await target.generate({
      ir,
      options: {},
      links: {},
      artefacts: new Set(["validators"]),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: expect.arrayContaining([
        expect.objectContaining({
          code: "unknownKeys.ignore.unsupported",
          message: expect.stringContaining("echoIgnoreKeys"),
        }),
        expect.objectContaining({
          code: "unknownKeys.keep.unsupported",
          message: expect.stringContaining("echoKeepKeys"),
        }),
      ]),
    });
  });
}
