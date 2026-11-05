import type { ContractIR } from "@seampact/spec/ir";
import type { GenerateRequest } from "../target.js";

/** The links of a client target generated beside a types target whose operations export Input, Output and Errors. */
export function typesLinks(ir: ContractIR): GenerateRequest["links"] {
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
