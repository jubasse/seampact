import type { QueryOperation, QueryPlan } from "@seampact/codegen-core";
import { propertyKey } from "@seampact/codegen-core";
import type { ReactQueryOptions } from "../options.js";
import {
  CONTRACT_ERROR_GUARD,
  keysObjectSource,
  nextPageConstantName,
  nextPageConstants,
  operationType,
  operationTypesSource,
  planForms,
  REQUIRED_CALL_TYPE,
  resourceTypeSource,
  resultExpression,
  settingsTypeSource,
} from "../shared/operation-sources.js";

// The server-safe `queries.ts` of one api for TanStack Query (ADR 0021 "The generated API"): the types each
// operation reads from the client, the caller option types, and `create<Api>Queries`, which returns `keys` and an
// options factory per operation. It holds no `"use client"` and imports no hook, so a server component prefetches
// with it.

/** The names the queries module imports from the client and the runtime, by the module specifier. */
export interface QueriesImports {
  readonly client: string;
  readonly runtime: string;
}

const TANSTACK_MODULE = "@tanstack/react-query";

/** The source of `queries.ts`. */
export function queriesModuleSource(
  plan: QueryPlan,
  options: ReactQueryOptions,
  root: string,
  imports: QueriesImports,
): string {
  const api = plan.apiName;
  const operations = plan.operations;
  const {
    mutation: hasMutation,
    query: hasQuery,
    infinite: hasInfinite,
    idempotency: hasIdempotency,
  } = planForms(plan);
  const throwsErrors = options.errors === "throw";

  const tanstackNames = [
    ...(hasInfinite
      ? ["type InfiniteData", "infiniteQueryOptions", "type UseInfiniteQueryOptions"]
      : []),
    ...(hasMutation ? ["mutationOptions", "type UseMutationOptions"] : []),
    "type QueryKey",
    ...(hasQuery ? ["queryOptions", "type UseQueryOptions"] : []),
  ];
  const runtimeNames = [
    ...(throwsErrors
      ? ["type FailureOf", "type SuccessOf", "successOrThrow"]
      : ["withPlainHeaders"]),
    ...(hasIdempotency ? ["IdempotencyKeys", "idempotencyKeyGenerator", "withIdempotencyKey"] : []),
    "keyRequest",
    ...(hasQuery ? ["withSignal"] : []),
    ...(hasInfinite ? ["type NextPageRule", "nextPageRequest"] : []),
    "type ClientResult",
    "type WithPlainHeaders",
  ];
  const clientNames = ["type Client", ...(throwsErrors ? ["ContractError"] : [])];

  return [
    [
      `import { ${tanstackNames.join(", ")} } from "${TANSTACK_MODULE}";`,
      `import { ${clientNames.join(", ")} } from "${imports.client}";`,
      `import { ${runtimeNames.join(", ")} } from "${imports.runtime}";`,
    ].join("\n"),
    operationTypesSource(api, operations, throwsErrors),
    ...(throwsErrors ? [CONTRACT_ERROR_GUARD] : []),
    callerOptionTypesSource({ hasQuery, hasInfinite, hasMutation }),
    settingsTypeSource(api),
    resourceTypeSource(plan),
    `const ROOT = ${JSON.stringify(root)};`,
    ...nextPageConstants(operations),
    factorySource(plan, options, hasIdempotency),
  ].join("\n\n");
}

function callerOptionTypesSource(forms: {
  hasQuery: boolean;
  hasInfinite: boolean;
  hasMutation: boolean;
}): string {
  const call = 'readonly call?: Operation["call"]';
  const sources = [
    ...(forms.hasQuery
      ? [
          `/** The caller's query options, spread after the generated ones; \`call\` passes the client's call options. */\nexport type QueryCallerOptions<Operation extends AnyOperationTypes, Selected = Operation["data"]> = Omit<UseQueryOptions<Operation["data"], Operation["error"], Selected>, "queryFn" | "queryKey"> & {\nreadonly queryKey?: QueryKey;\n${call};\n};`,
        ]
      : []),
    ...(forms.hasInfinite
      ? [
          `/** The caller's infinite query options; the pages start from the request and follow the contract's page facts unless the caller sets them. */\nexport type InfiniteQueryCallerOptions<Operation extends AnyOperationTypes, Selected = InfiniteData<Operation["data"], Operation["request"]>> = Omit<UseInfiniteQueryOptions<Operation["data"], Operation["error"], Selected, QueryKey, Operation["request"]>, "queryFn" | "queryKey" | "initialPageParam" | "getNextPageParam"> & Partial<Pick<UseInfiniteQueryOptions<Operation["data"], Operation["error"], Selected, QueryKey, Operation["request"]>, "initialPageParam" | "getNextPageParam">> & {\nreadonly queryKey?: QueryKey;\n${call};\n};`,
        ]
      : []),
    ...(forms.hasMutation
      ? [
          `/** The caller's mutation options; its \`onSuccess\` runs after the generated invalidation. */\nexport type MutationCallerOptions<Operation extends AnyOperationTypes, OnMutateResult = unknown> = Omit<UseMutationOptions<Operation["data"], Operation["error"], Operation["request"], OnMutateResult>, "mutationFn"> & {\n${call};\n};`,
        ]
      : []),
    REQUIRED_CALL_TYPE,
  ];

  return sources.join("\n\n");
}

function factorySource(
  plan: QueryPlan,
  options: ReactQueryOptions,
  hasIdempotency: boolean,
): string {
  const api = plan.apiName;
  const members = plan.operations.flatMap((operation) => memberSources(operation, api, options));
  const idempotency = hasIdempotency
    ? "const idempotencyKeys = new IdempotencyKeys(idempotencyKeyGenerator(settings.idempotencyKey));\n\n"
    : "";
  const settingsParameter = hasIdempotency ? "settings" : "_settings";

  return `/**
 * The api's keys and, per operation, its query, infinite query or mutation options over \`client\`, for
 * \`useQuery\`, \`useSuspenseQuery\`, \`prefetchQuery\` and the other TanStack Query entry points.
 */
export function create${api}Queries(client: Client, ${settingsParameter}: ${api}QueriesSettings = {}) {
${idempotency}${keysObjectSource(plan)}

return {
keys,
${members.join(",\n\n")},
};
}

/** What \`create${api}Queries\` returns. */
export type ${api}Queries = ReturnType<typeof create${api}Queries>;`;
}

function memberSources(
  operation: QueryOperation,
  api: string,
  options: ReactQueryOptions,
): string[] {
  if (operation.form === "mutation") return [mutationSource(operation, api, options)];

  const plain = querySource(operation, api, options);

  return operation.names.infinite === undefined
    ? [plain]
    : [plain, infiniteSource(operation, api, options)];
}

// The caller options parameter: optional with a default, or required when the method requires a timeout.
function optionsParameter(operation: QueryOperation, type: string): string {
  return operation.needsTimeout ? `options: WithRequiredCall<${type}>` : `options: ${type} = {}`;
}

function staleTimeMember(operation: QueryOperation, options: ReactQueryOptions): string {
  return options.staleTime === "contract" ? `staleTime: ${operation.freshnessMs},\n` : "";
}

function querySource(operation: QueryOperation, api: string, options: ReactQueryOptions): string {
  const { names } = operation;
  const types = operationType(operation, api);
  const call = `await client.${names.base}(request, withSignal(call, signal))`;

  return `${propertyKey(names.options)}<Selected = ${types}["data"]>(request: ${types}["request"], ${optionsParameter(operation, `QueryCallerOptions<${types}, Selected>`)}) {
const { call, ...callerOptions } = options;

return queryOptions<${types}["data"], ${types}["error"], Selected, QueryKey>({
queryKey: keys.${names.base}(request),
queryFn: async ({ signal }) => ${resultExpression(operation, call, options)},
${staleTimeMember(operation, options)}...callerOptions,
});
}`;
}

function infiniteSource(
  operation: QueryOperation,
  api: string,
  options: ReactQueryOptions,
): string {
  const { names } = operation;
  const infinite = names.infinite;

  if (infinite === undefined) return "";

  const types = operationType(operation, api);
  const call = `await client.${names.base}(pageParam, withSignal(call, signal))`;

  return `${propertyKey(infinite.options)}<Selected = InfiniteData<${types}["data"], ${types}["request"]>>(request: ${types}["request"], ${optionsParameter(operation, `InfiniteQueryCallerOptions<${types}, Selected>`)}) {
const { call, ...callerOptions } = options;

return infiniteQueryOptions<${types}["data"], ${types}["error"], Selected, QueryKey, ${types}["request"]>({
queryKey: keys.${infinite.key}(request),
queryFn: async ({ pageParam, signal }) => ${resultExpression(operation, call, options)},
initialPageParam: request,
getNextPageParam: (lastPage, _pages, lastPageParam) => nextPageRequest(${nextPageConstantName(operation)}, lastPageParam, lastPage),
${staleTimeMember(operation, options)}...callerOptions,
});
}`;
}

function mutationSource(
  operation: QueryOperation,
  api: string,
  options: ReactQueryOptions,
): string {
  const { names } = operation;
  const types = operationType(operation, api);
  const request =
    operation.idempotencyHeaderKey === undefined
      ? "request"
      : `withIdempotencyKey(request, ${JSON.stringify(operation.idempotencyHeaderKey)}, () => idempotencyKeys.keyFor(context))`;
  const contextParameter = operation.idempotencyHeaderKey === undefined ? "" : ", context";
  const call = `await client.${names.base}(${request}, { ...call })`;
  const invalidates = options.invalidate === "resource" && operation.resource !== undefined;
  const destructured = invalidates
    ? "{ call, onSuccess, ...callerOptions }"
    : "{ call, ...callerOptions }";
  const onSuccess = invalidates
    ? `\nonSuccess: async (data, request, onMutateResult, context) => {
await context.client.invalidateQueries({ queryKey: keys.resource(${JSON.stringify(operation.resource)}) });
await onSuccess?.(data, request, onMutateResult, context);
},`
    : "";

  return `${propertyKey(names.options)}<OnMutateResult = unknown>(${optionsParameter(operation, `MutationCallerOptions<${types}, OnMutateResult>`)}) {
const ${destructured} = options;

return mutationOptions<${types}["data"], ${types}["error"], ${types}["request"], OnMutateResult>({
mutationFn: async (request${contextParameter}) => ${resultExpression(operation, call, options)},
...callerOptions,${onSuccess}
});
}`;
}
