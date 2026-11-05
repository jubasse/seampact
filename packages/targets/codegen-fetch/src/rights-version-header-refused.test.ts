import type { GenerateRequest } from "@seampact/codegen-core";
import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import type { ContractIR } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { target as clientTarget } from "./index.js";

// The client does not read typed response headers yet, so a contract whose operator write answers the rights-version
// header (CHK-013) is refused by name at generation.
test("the rights-version response header of an operator write is refused by name", async () => {
  const ir = readGoldenIr("tasks");
  const write = ir.operations.find((operation) => operation.id === "updateTask");
  const [success] = write?.responses ?? [];

  if (success === undefined) throw new Error("the golden tasks api has no updateTask response");

  success.headers = [
    ...success.headers,
    {
      name: "X-Rights-Version",
      required: false,
      type: { kind: "scalar", type: "string", refinements: {} },
    },
  ];

  const outcome = await clientTarget.generate({
    ir,
    options: {},
    links: typesLinks(ir),
    artefacts: new Set(["client"]),
  });

  expect(outcome).toMatchObject({
    status: "refused",
    refusals: expect.arrayContaining([
      expect.objectContaining({ code: "response.header.unsupported", operation: "updateTask" }),
    ]),
  });
});

function typesLinks(ir: ContractIR): GenerateRequest["links"] {
  const exportOf = (role: string) => ({ module: "operations", export: role });

  return {
    types: {
      descriptor: {
        kind: "types",
        style: "typescript",
        schemas: {},
        operations: Object.fromEntries(
          ir.operations.map((operation) => [
            operation.id,
            { input: exportOf("Input"), output: exportOf("Output"), errors: exportOf("Errors") },
          ]),
        ),
      },
      location: { kind: "relative", path: "../types" },
    },
  };
}
