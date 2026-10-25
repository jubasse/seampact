import {
  CONTRACT_ERROR_GUARD,
  type FrontErrors,
  factoryOptionsParameter,
  keysObjectSource,
  nextPageConstantName,
  nextPageConstants,
  operationType,
  operationTypesSource,
  planForms,
  propertyKey,
  type QueriesImports,
  type QueryOperation,
  type QueryPlan,
  REQUIRED_CALL_TYPE,
  resourceTypeSource,
  resultExpression,
  settingsTypeSource,
  staleTimeMember,
} from "@seampact/codegen-core";

// The `queries.ts` of one api for Pinia Colada (ADR 0021 "The generated API"): the operation types, the caller option
// types and `create<Api>Queries`, which returns `keys` and an options factory per operation, built with Pinia
// Colada's `define*Options` so a key read back from the cache keeps its data type. It imports no composable.
// Pinia Colada keys are JSON values, so the key of an operation with no request ends in `null`; a mutation that
// refreshes a resource takes the app's query cache, which only a component or a store can inject.

const PINIA_COLADA_MODULE = "@pinia/colada";

// A key segment for an operation with no request: Pinia Colada keys take no `undefined`.
const ABSENT_REQUEST_SEGMENT = "null";

/** The options the Pinia Colada queries module reads. */
export interface PiniaColadaQueriesOptions {
  readonly errors: FrontErrors;
  readonly invalidate: "resource" | "off";
  readonly staleTime: "off" | "contract";
}

/** The source of the Pinia Colada `queries.ts`. */
export function queriesModuleSource(
  plan: QueryPlan,
  options: PiniaColadaQueriesOptions,
  root: string,
  imports: QueriesImports,
): string {
  const api = plan.apiName;
  const forms = planForms(plan);
  const throwsErrors = options.errors === "throw";
  const refreshesResources = plan.operations.some((operation) =>
    refreshesResource(operation, options),
  );

  const coladaNames = [
    ...(forms.infinite ? ["type DefineInfiniteQueryOptions", "defineInfiniteQueryOptions"] : []),
    ...(forms.mutation ? ["defineMutationOptions"] : []),
    ...(forms.query ? ["type DefineQueryOptions", "defineQueryOptions"] : []),
    "type EntryKey",
    ...(refreshesResources ? ["type QueryCache"] : []),
    ...(forms.mutation ? ["type UseMutationOptions"] : []),
  ];
  const runtimeNames = [
    ...(throwsErrors
      ? ["type FailureOf", "type SuccessOf", "successOrThrow"]
      : ["withPlainHeaders"]),
    ...(forms.idempotency
      ? ["IdempotencyKeys", "idempotencyKeyGenerator", "withIdempotencyKey"]
      : []),
    "keyRequest",
    ...(forms.query ? ["runWithSignal"] : []),
    ...(forms.infinite ? ["type NextPageRule", "nextPageRequest"] : []),
    "type ClientResult",
    "type WithPlainHeaders",
  ];
  const clientNames = ["type Client", ...(throwsErrors ? ["ContractError"] : [])];

  return [
    [
      `import { ${coladaNames.join(", ")} } from "${PINIA_COLADA_MODULE}";`,
      `import { ${clientNames.join(", ")} } from "${imports.client}";`,
      `import { ${runtimeNames.join(", ")} } from "${imports.runtime}";`,
    ].join("\n"),
    operationTypesSource(api, plan.operations, options.errors, "perOperation"),
    ...(throwsErrors ? [CONTRACT_ERROR_GUARD] : []),
    callerOptionTypesSource(forms),
    settingsTypeSource(api),
    resourceTypeSource(plan),
    `const ROOT = ${JSON.stringify(root)};`,
    ...nextPageConstants(plan.operations),
    factorySource(plan, options, forms.idempotency),
  ].join("\n\n");
}

/** Whether the mutation refreshes its resource's queries, so its options factory takes the query cache. */
export function refreshesResource(
  operation: QueryOperation,
  options: { readonly invalidate: "resource" | "off" },
): boolean {
  return (
    operation.form === "mutation" &&
    options.invalidate === "resource" &&
    operation.resource !== undefined
  );
}

function callerOptionTypesSource(forms: {
  readonly query: boolean;
  readonly infinite: boolean;
  readonly mutation: boolean;
}): string {
  const call = 'readonly call?: Operation["call"]';
  const infiniteOptions =
    'DefineInfiniteQueryOptions<Operation["data"], Operation["error"], Operation["request"]>';
  const sources = [
    ...(forms.query
      ? [
          `/** The caller's query options, spread after the generated ones; \`call\` passes the client's call options. */\nexport type QueryCallerOptions<Operation extends AnyOperationTypes> = Omit<DefineQueryOptions<Operation["data"], Operation["error"]>, "query" | "key"> & {\nreadonly key?: EntryKey;\n${call};\n};`,
        ]
      : []),
    ...(forms.infinite
      ? [
          `/** The caller's infinite query options; the pages start from the request and follow the contract's page facts unless the caller sets them. */\nexport type InfiniteQueryCallerOptions<Operation extends AnyOperationTypes> = Omit<${infiniteOptions}, "query" | "key" | "initialPageParam" | "getNextPageParam"> & Partial<Pick<${infiniteOptions}, "initialPageParam" | "getNextPageParam">> & {\nreadonly key?: EntryKey;\n${call};\n};`,
        ]
      : []),
    ...(forms.mutation
      ? [
          `/** The caller's mutation options; its \`onSuccess\` runs after the generated refresh. */\nexport type MutationCallerOptions<Operation extends AnyOperationTypes, OnMutateResult extends Record<string, unknown> = Record<never, never>> = Omit<UseMutationOptions<Operation["data"], Operation["request"], Operation["error"], OnMutateResult>, "mutation"> & {\n${call};\n};`,
        ]
      : []),
    REQUIRED_CALL_TYPE,
  ];

  return sources.join("\n\n");
}

function factorySource(
  plan: QueryPlan,
  options: PiniaColadaQueriesOptions,
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
 * \`useQuery\`, \`useInfiniteQuery\`, \`useMutation\` and the query cache.
 */
export function create${api}Queries(client: Client, ${settingsParameter}: ${api}QueriesSettings = {}) {
${idempotency}${keysObjectSource(plan, ABSENT_REQUEST_SEGMENT)}

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
  options: PiniaColadaQueriesOptions,
): string[] {
  if (operation.form === "mutation") return [mutationSource(operation, api, options)];

  const plain = querySource(operation, api, options);

  return operation.names.infinite === undefined
    ? [plain]
    : [plain, infiniteSource(operation, api, options)];
}

function querySource(
  operation: QueryOperation,
  api: string,
  options: PiniaColadaQueriesOptions,
): string {
  const { names } = operation;
  const types = operationType(operation, api);
  const call = `await runWithSignal(call, signal, (callWithSignal) => client.${names.base}(request, callWithSignal))`;

  return `${propertyKey(names.options)}(request: ${types}["request"], ${factoryOptionsParameter(operation, `QueryCallerOptions<${types}>`)}) {
const { call, ...callerOptions } = options;

return defineQueryOptions<${types}["data"], ${types}["error"]>({
key: keys.${names.base}(request),
query: async ({ signal }) => ${resultExpression(operation, call, options)},
${staleTimeMember(operation, options)}...callerOptions,
});
}`;
}

function infiniteSource(
  operation: QueryOperation,
  api: string,
  options: PiniaColadaQueriesOptions,
): string {
  const { names } = operation;
  const infinite = names.infinite;

  if (infinite === undefined) return "";

  const types = operationType(operation, api);
  const call = `await runWithSignal(call, signal, (callWithSignal) => client.${names.base}(pageParam, callWithSignal))`;

  return `${propertyKey(infinite.options)}(request: ${types}["request"], ${factoryOptionsParameter(operation, `InfiniteQueryCallerOptions<${types}>`)}) {
const { call, ...callerOptions } = options;

return defineInfiniteQueryOptions<${types}["data"], ${types}["error"], ${types}["request"]>({
key: keys.${infinite.key}(request),
query: async ({ pageParam, signal }) => ${resultExpression(operation, call, options)},
initialPageParam: request,
getNextPageParam: (lastPage, _pages, lastPageParam) => nextPageRequest(${nextPageConstantName(operation)}, lastPageParam, lastPage),
${staleTimeMember(operation, options)}...callerOptions,
});
}`;
}

// A mutation that refreshes a resource takes the query cache first; Pinia Colada's mutation context carries none.
function mutationSource(
  operation: QueryOperation,
  api: string,
  options: PiniaColadaQueriesOptions,
): string {
  const { names } = operation;
  const types = operationType(operation, api);
  const keyed = operation.idempotencyHeaderKey !== undefined;
  const request = keyed
    ? `withIdempotencyKey(request, ${JSON.stringify(operation.idempotencyHeaderKey)}, () => idempotencyKeys.keyFor(context))`
    : "request";
  const contextParameter = keyed ? ", context" : "";
  const call = `await client.${names.base}(${request}, { ...call })`;
  const refreshes = refreshesResource(operation, options);
  const cacheParameter = refreshes ? "queryCache: QueryCache, " : "";
  const destructured = refreshes
    ? "{ call, onSuccess, ...callerOptions }"
    : "{ call, ...callerOptions }";
  const onSuccess = refreshes
    ? `\nonSuccess: async (data, request, context) => {
await queryCache.invalidateQueries({ key: keys.resource(${JSON.stringify(operation.resource)}) });
await onSuccess?.(data, request, context);
},`
    : "";

  return `${propertyKey(names.options)}<OnMutateResult extends Record<string, unknown> = Record<never, never>>(${cacheParameter}${factoryOptionsParameter(operation, `MutationCallerOptions<${types}, OnMutateResult>`)}) {
const ${destructured} = options;

return defineMutationOptions<${types}["data"], ${types}["request"], ${types}["error"], OnMutateResult>({
mutation: async (request${contextParameter}) => ${resultExpression(operation, call, options)},
...callerOptions,${onSuccess}
});
}`;
}
