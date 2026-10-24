import type { QueryOperation, QueryPlan } from "@seampact/codegen-core";
import { propertyKey } from "@seampact/codegen-core";
import type { ReactQueryOptions } from "../options.js";
import {
  CONTRACT_ERROR_GUARD,
  operationType,
  operationTypesSource,
  planForms,
  type QueriesImports,
  resultExpression,
  settingsTypeSource,
} from "../shared/operation-sources.js";

// The server-safe `queries.ts` of one api for plain fetch (ADR 0021 "Plain fetch"): the types each operation reads
// from the client and `create<Api>Queries`, which returns per operation the fetcher its hook calls. It has no keys
// and imports no React, so a server component reads its data with it.

/** The source of `queries.ts`. */
export function queriesModuleSource(
  plan: QueryPlan,
  options: ReactQueryOptions,
  imports: QueriesImports,
): string {
  const api = plan.apiName;
  const operations = plan.operations;
  const forms = planForms(plan);
  const throwsErrors = options.errors === "throw";
  const runtimeNames = [
    ...(throwsErrors
      ? ["type FailureOf", "type SuccessOf", "successOrThrow"]
      : ["withPlainHeaders"]),
    ...(forms.idempotency
      ? ["IdempotencyKeys", "idempotencyKeyGenerator", "withIdempotencyKey"]
      : []),
    ...(forms.query ? ["runWithSignal"] : []),
    "type ClientResult",
    "type WithPlainHeaders",
  ];
  const clientNames = ["type Client", ...(throwsErrors ? ["ContractError"] : [])];

  return [
    [
      `import { ${clientNames.join(", ")} } from "${imports.client}";`,
      `import { ${runtimeNames.join(", ")} } from "${imports.runtime}";`,
    ].join("\n"),
    operationTypesSource(api, operations, options.errors, "perOperation"),
    ...(throwsErrors ? [CONTRACT_ERROR_GUARD] : []),
    settingsTypeSource(api),
    factorySource(plan, options, forms.idempotency),
  ].join("\n\n");
}

function factorySource(
  plan: QueryPlan,
  options: ReactQueryOptions,
  hasIdempotency: boolean,
): string {
  const api = plan.apiName;
  const members = plan.operations.map((operation) => memberSource(operation, api, options));
  const idempotency = hasIdempotency
    ? "const idempotencyKeys = new IdempotencyKeys(idempotencyKeyGenerator(settings.idempotencyKey));\n\n"
    : "";
  const settingsParameter = hasIdempotency ? "settings" : "_settings";

  return `/**
 * Per operation, the fetcher of its query, called with an abort signal, or of its mutation, called with the request
 * and one attempt object per \`mutate\`: every call with the same attempt sends the same idempotency key.
 */
export function create${api}Queries(client: Client, ${settingsParameter}: ${api}QueriesSettings = {}) {
${idempotency}return {
${members.join(",\n\n")},
};
}

/** What \`create${api}Queries\` returns. */
export type ${api}Queries = ReturnType<typeof create${api}Queries>;`;
}

// The call options parameter: optional, or required when the method requires a timeout.
function callParameter(operation: QueryOperation, types: string): string {
  return operation.needsTimeout ? `call: ${types}["call"]` : `call?: ${types}["call"]`;
}

function memberSource(operation: QueryOperation, api: string, options: ReactQueryOptions): string {
  return operation.form === "mutation"
    ? mutationSource(operation, api, options)
    : querySource(operation, api, options);
}

function querySource(operation: QueryOperation, api: string, options: ReactQueryOptions): string {
  const { names } = operation;
  const types = operationType(operation, api);
  const call = `await runWithSignal(call, signal, (callWithSignal) => client.${names.base}(request, callWithSignal))`;

  return `${propertyKey(names.options)}(request: ${types}["request"], ${callParameter(operation, types)}) {
return {
fetcher: async (signal: AbortSignal): Promise<${types}["data"]> => ${resultExpression(operation, call, options)},
};
}`;
}

function mutationSource(
  operation: QueryOperation,
  api: string,
  options: ReactQueryOptions,
): string {
  const { names } = operation;
  const types = operationType(operation, api);
  const keyed = operation.idempotencyHeaderKey !== undefined;
  const request = keyed
    ? `withIdempotencyKey(request, ${JSON.stringify(operation.idempotencyHeaderKey)}, () => idempotencyKeys.keyFor(attempt))`
    : "request";
  const attemptParameter = keyed ? "attempt" : "_attempt";
  const call = `await client.${names.base}(${request}, { ...call })`;

  return `${propertyKey(names.options)}(${callParameter(operation, types)}) {
return {
fetcher: async (request: ${types}["request"], ${attemptParameter}: object): Promise<${types}["data"]> => ${resultExpression(operation, call, options)},
};
}`;
}
