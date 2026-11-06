import { readFileSync } from "node:fs";
import { readGoldenIr, typesLinks } from "@seampact/codegen-core/node-server/test-support";
import type { ContractIR } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { target } from "./index.js";

// The response forms the generated client does not read yet, each refused by name when it is generated.

const STUDIO_IR = new URL("../../../../fixtures/golden/extensions/studio.ir.json", import.meta.url);

async function refusalCodesOf(ir: ContractIR): Promise<string[]> {
  const outcome = await target.generate({
    ir,
    options: {},
    links: typesLinks(ir),
    artefacts: new Set(["client"]),
  });

  return outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.code) : [];
}

test("a deprecated operation is refused by name", async () => {
  expect(await refusalCodesOf(readGoldenIr("tasksResponses"))).toContain("deprecated.unsupported");
});

test("a degraded-parts header is refused by name", async () => {
  expect(await refusalCodesOf(JSON.parse(readFileSync(STUDIO_IR, "utf8")))).toContain(
    "degradable.header.unsupported",
  );
});

test("a response header the route writes itself is refused by name", async () => {
  const ir = readGoldenIr("tasks");
  const created = ir.operations
    .find((operation) => operation.id === "createTask")
    ?.responses.find((response) => response.status === 201);

  if (created === undefined) throw new Error("the golden createTask has no 201 response");

  created.headers.push({
    name: "Location",
    required: true,
    type: { kind: "scalar", type: "string", refinements: {} },
  });

  expect(await refusalCodesOf(ir)).toContain("response.header.unsupported");
});
