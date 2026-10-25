import type { GenerateRequest, TypesDescriptor } from "@seampact/codegen-core";
import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import type { ContractIR } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { target } from "./index.js";

const ir = readGoldenIr("tasks");

// A types descriptor naming one module per role: the handlers' code does not depend on the type names.
function typesLink(contract: ContractIR): GenerateRequest["links"] {
  const typeExport = (operationId: string, role: string) => ({
    module: "operations",
    export: `${operationId}${role}`,
  });
  const descriptor: TypesDescriptor = {
    kind: "types",
    style: "typescript",
    schemas: {},
    operations: Object.fromEntries(
      contract.operations.map((operation) => [
        operation.id,
        {
          input: typeExport(operation.id, "Input"),
          output: typeExport(operation.id, "Output"),
          errors: typeExport(operation.id, "Errors"),
        },
      ]),
    ),
  };

  return { types: { descriptor, location: { kind: "relative", path: "../../types/tasks" } } };
}

test("the reference contract's handlers match their golden files", async () => {
  const outcome = await target.generate({
    ir,
    options: {},
    links: typesLink(ir),
    artefacts: new Set(["handlers"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome));

  for (const file of outcome.files.filter((generated) => generated.path !== "runtime.ts")) {
    await expect(file.contents).toMatchFileSnapshot(`../golden/tasks/${file.path}`);
  }

  expect(outcome.files.map((file) => file.path)).toEqual(["index.ts", "mocks.ts", "runtime.ts"]);
});

test("an operation named like the list of default handlers is refused by name", async () => {
  const [first, ...rest] = ir.operations;

  if (first === undefined) throw new Error("the reference contract has no operation");

  const renamed: ContractIR = {
    ...ir,
    operations: [{ ...first, name: { ...first.name, segments: ["handlers"] } }, ...rest],
  };
  const outcome = await target.generate({
    ir: renamed,
    options: {},
    links: typesLink(renamed),
    artefacts: new Set(["handlers"]),
  });

  expect(
    outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.code) : [],
  ).toEqual(["names.collision"]);
});
