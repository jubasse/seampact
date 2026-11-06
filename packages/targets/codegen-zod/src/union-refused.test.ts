import { readFileSync } from "node:fs";
import type { ContractIR } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { target } from "./index.js";

// The validators refuse a tagged union by name in 1.0: no strict server check and no open client read of one.

const STUDIO_IR = new URL("../../../../fixtures/golden/extensions/studio.ir.json", import.meta.url);

test("a tagged union is refused by name", async () => {
  const ir: ContractIR = JSON.parse(readFileSync(STUDIO_IR, "utf8"));
  const outcome = await target.generate({
    ir,
    options: {},
    links: {},
    artefacts: new Set(["validators"]),
  });

  expect(outcome.status === "refused" && outcome.refusals.map((refusal) => refusal.code)).toContain(
    "schema.union.unsupported",
  );
});
