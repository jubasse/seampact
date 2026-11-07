import type {
  ClientDescriptor,
  ClientExports,
  DescribeOutcome,
  ProvidedDescriptors,
} from "@seampact/codegen-core";
import { typeScriptIdentifier } from "@seampact/codegen-core";
import type { ContractIR, Operation } from "@seampact/spec/ir";
import { deriveName } from "@seampact/spec/naming";
import { INDEX_MODULE } from "./client-module.js";
import type { FetchClientOptions } from "./options.js";

// The client's public names, all read from the api's index module.
const CLIENT_EXPORTS: ClientExports = {
  createClient: { module: INDEX_MODULE, export: "createClient" },
  Client: { module: INDEX_MODULE, export: "Client" },
  ContractError: { module: INDEX_MODULE, export: "ContractError" },
  CallOptions: { module: INDEX_MODULE, export: "CallOptions" },
};

// The `client` descriptor (ADR 0009 "The provider seam"): the exports a front target imports, the client's error
// style, and the method of each operation. What the client refuses, its generate reports.
export function describeClient(
  ir: ContractIR,
  options: FetchClientOptions,
): DescribeOutcome<ProvidedDescriptors<"client">> {
  const client: ClientDescriptor = {
    kind: "client",
    style: "fetch",
    errorStyle: options.errorStyle,
    exports: structuredClone(CLIENT_EXPORTS),
    operations: Object.fromEntries(
      ir.operations.map((operation) => [operation.id, { method: clientMethodName(operation) }]),
    ),
  };

  return { status: "described", descriptors: { client } };
}

// The member of `Client` that calls the operation.
export function clientMethodName(operation: Operation): string {
  return typeScriptIdentifier(deriveName(operation.name.segments, "operation"));
}
