import { propertyKey } from "../property-key.js";
import {
  CONTRACT_ERROR_GUARD,
  type FrontErrors,
  keysObjectSource,
  nextPageConstantName,
  nextPageConstants,
  operationType,
  operationTypesSource,
  planForms,
  type QueriesImports,
  REQUIRED_CALL_TYPE,
  resourceTypeSource,
  resultExpression,
  settingsTypeSource,
} from "./operation-sources.js";
import type { QueryOperation, QueryPlan } from "./query-plan.js";

// The `queries.ts` of one api for TanStack Query, shared by the front targets (ADR 0021 "The generated API"): the
// types each operation reads from the client, the caller option types, and `create<Api>Queries`, which returns
// `keys` and an options factory per operation. It imports no hook, so server code prefetches with it.

/** The options the TanStack Query queries module reads. */
export interface TanstackQueriesOptions {
  readonly errors: FrontErrors;
  readonly invalidate: "resource" | "off";
  readonly staleTime: "off" | "contract";
}

/**
 * What differs between the framework adapters of TanStack Query: the package, the option types the caller options
 * are built on (each taking the same type parameters as React's `UseQueryOptions`, `UseInfiniteQueryOptions` and
 * `UseMutationOptions`), and the entry points the factory's comment names.
 */
export interface TanstackAdapter {
  readonly module: string;
  readonly queryOptionsType: string;
  readonly infiniteQueryOptionsType: string;
  readonly mutationOptionsType: string;
  readonly entryPoints: string;
}

/** The source of the TanStack Query `queries.ts`. */
export function tanstackQueriesModuleSource(
  plan: QueryPlan,
  options: TanstackQueriesOptions,
  root: string,
  imports: QueriesImports,
  adapter: TanstackAdapter,
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
      ? ["type InfiniteData", "infiniteQueryOptions", `type ${adapter.infiniteQueryOptionsType}`]
      : []),
    ...(hasMutation ? ["mutationOptions", `type ${adapter.mutationOptionsType}`] : []),
    "type QueryKey",
    ...(hasQuery ? ["queryOptions", `type ${adapter.queryOptionsType}`] : []),
  ];
  const runtimeNames = [
    ...(throwsErrors
      ? ["type FailureOf", "type SuccessOf", "successOrThrow"]
      : ["withPlainHeaders"]),
    ...(hasIdempotency ? ["IdempotencyKeys", "idempotencyKeyGenerator", "withIdempotencyKey"] : []),
    "keyRequest",
    ...(hasQuery ? ["runWithSignal"] : []),
    ...(hasInfinite ? ["type NextPageRule", "nextPageRequest"] : []),
    "type ClientResult",
    "type WithPlainHeaders",
  ];
  const clientNames = ["type Client", ...(throwsErrors ? ["ContractError"] : [])];

  return [
    [
      `import { ${tanstackNames.join(", ")} } from "${adapter.module}";`,
      `import { ${clientNames.join(", ")} } from "${imports.client}";`,
      `import { ${runtimeNames.join(", ")} } from "${imports.runtime}";`,
    ].join("\n"),
    operationTypesSource(api, operations, options.errors, "perOperation"),
    ...(throwsErrors ? [CONTRACT_ERROR_GUARD] : []),
    callerOptionTypesSource({ hasQuery, hasInfinite, hasMutation }, adapter),
    settingsTypeSource(api),
    resourceTypeSource(plan),
    `const ROOT = ${JSON.stringify(root)};`,
    ...nextPageConstants(operations),
    factorySource(plan, options, hasIdempotency, adapter),
  ].join("\n\n");
}

function callerOptionTypesSource(
  forms: { hasQuery: boolean; hasInfinite: boolean; hasMutation: boolean },
  adapter: TanstackAdapter,
): string {
  const call = 'readonly call?: Operation["call"]';
  const sources = [
    ...(forms.hasQuery
      ? [
          `/** The caller's query options, spread after the generated ones; \`call\` passes the client's call options. */\nexport type QueryCallerOptions<Operation extends AnyOperationTypes, Selected = Operation["data"]> = Omit<${adapter.queryOptionsType}<Operation["data"], Operation["error"], Selected>, "queryFn" | "queryKey"> & {\nreadonly queryKey?: QueryKey;\n${call};\n};`,
        ]
      : []),
    ...(forms.hasInfinite
      ? [
          `/** The caller's infinite query options; the pages start from the request and follow the contract's page facts unless the caller sets them. */\nexport type InfiniteQueryCallerOptions<Operation extends AnyOperationTypes, Selected = InfiniteData<Operation["data"], Operation["request"]>> = Omit<${adapter.infiniteQueryOptionsType}<Operation["data"], Operation["error"], Selected, QueryKey, Operation["request"]>, "queryFn" | "queryKey" | "initialPageParam" | "getNextPageParam"> & Partial<Pick<${adapter.infiniteQueryOptionsType}<Operation["data"], Operation["error"], Selected, QueryKey, Operation["request"]>, "initialPageParam" | "getNextPageParam">> & {\nreadonly queryKey?: QueryKey;\n${call};\n};`,
        ]
      : []),
    ...(forms.hasMutation
      ? [
          `/** The caller's mutation options; its \`onSuccess\` runs after the generated invalidation. */\nexport type MutationCallerOptions<Operation extends AnyOperationTypes, OnMutateResult = unknown> = Omit<${adapter.mutationOptionsType}<Operation["data"], Operation["error"], Operation["request"], OnMutateResult>, "mutationFn"> & {\n${call};\n};`,
        ]
      : []),
    REQUIRED_CALL_TYPE,
  ];

  return sources.join("\n\n");
}

function factorySource(
  plan: QueryPlan,
  options: TanstackQueriesOptions,
  hasIdempotency: boolean,
  adapter: TanstackAdapter,
): string {
  const api = plan.apiName;
  const members = plan.operations.flatMap((operation) => memberSources(operation, api, options));
  const idempotency = hasIdempotency
    ? "const idempotencyKeys = new IdempotencyKeys(idempotencyKeyGenerator(settings.idempotencyKey));\n\n"
    : "";
  const settingsParameter = hasIdempotency ? "settings" : "_settings";

  return `/**
 * The api's keys and, per operation, its query, infinite query or mutation options over \`client\`, for
 * ${adapter.entryPoints} and the other TanStack Query entry points.
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
  options: TanstackQueriesOptions,
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

function staleTimeMember(operation: QueryOperation, options: TanstackQueriesOptions): string {
  return options.staleTime === "contract" ? `staleTime: ${operation.freshnessMs},\n` : "";
}

function querySource(
  operation: QueryOperation,
  api: string,
  options: TanstackQueriesOptions,
): string {
  const { names } = operation;
  const types = operationType(operation, api);
  const call = `await runWithSignal(call, signal, (callWithSignal) => client.${names.base}(request, callWithSignal))`;

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
  options: TanstackQueriesOptions,
): string {
  const { names } = operation;
  const infinite = names.infinite;

  if (infinite === undefined) return "";

  const types = operationType(operation, api);
  const call = `await runWithSignal(call, signal, (callWithSignal) => client.${names.base}(pageParam, callWithSignal))`;

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
  options: TanstackQueriesOptions,
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
