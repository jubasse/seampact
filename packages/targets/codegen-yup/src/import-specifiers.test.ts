import { readFileSync } from "node:fs";
import type { ContractIR } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { target } from "./index.js";

const GOLDEN_IR = new URL("../../../../fixtures/golden/reference/tasks.ir.json", import.meta.url);
const RELATIVE_SPECIFIER = /from "(\.{1,2}\/[^"]*)"/g;

test("an extensionless entry gets relative imports without .js, as a Next.js consumer resolves them", async () => {
  const ir: ContractIR = JSON.parse(readFileSync(GOLDEN_IR, "utf8"));
  const outcome = await target.generate({
    ir,
    options: {},
    links: {},
    artefacts: new Set(["validators"]),
    importSpecifiers: "extensionless",
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  const specifiers = outcome.files.flatMap((file) =>
    [...file.contents.matchAll(RELATIVE_SPECIFIER)].map((match) => match[1] ?? ""),
  );

  expect(specifiers.length).toBeGreaterThan(0);
  expect(specifiers.filter((specifier) => specifier.endsWith(".js"))).toEqual([]);
});
