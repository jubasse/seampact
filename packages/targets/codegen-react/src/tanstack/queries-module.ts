import type { NextPageRule, QueryOperation, QueryPlan } from "@seampact/codegen-core";
import { propertyKey } from "@seampact/codegen-core";
import type { ReactQueryOptions } from "../options.js";

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
  const hasMutation = operations.some((operation) => operation.form === "mutation");
  const hasQuery = operations.some((operation) => operation.form === "query");
  const hasInfinite = operations.some((operation) => operation.names.infinite !== undefined);
  const hasIdempotency = operations.some(
    (operation) => operation.idempotencyHeaderKey !== undefined,
  );
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
    callerOptionTypesSource({ hasQuery, hasInfinite, hasMutation }),
    `/** The factory settings: \`idempotencyKey\` replaces \`crypto.randomUUID\` as the idempotency key generator. */\nexport interface ${api}QueriesSettings {\nreadonly idempotencyKey?: () => string;\n}`,
    `/** The resource types the keys of the api sit under. */\nexport type ${api}Resource = ${resourceUnion(plan.resources)};`,
    `const ROOT = ${JSON.stringify(root)};`,
    ...operations.flatMap((operation) => nextPageConstant(operation)),
    factorySource(plan, options, hasIdempotency),
  ].join("\n\n");
}

function operationTypesSource(
  api: string,
  operations: readonly QueryOperation[],
  throwsErrors: boolean,
): string {
  const data = throwsErrors
    ? "WithPlainHeaders<SuccessOf<MethodResult<Method>>>"
    : "WithPlainHeaders<MethodResult<Method>>";
  const error = throwsErrors
    ? "ContractError<Id, FailureOf<MethodResult<Method>>> | Error"
    : "Error";
  const errorComment = throwsErrors
    ? "a declared error or an unexpected answer as the client's `ContractError`, or the client's rejection"
    : "the client's rejection (network failure, timeout or abort); declared errors are data";
  const members = operations.map(
    ({ operationId, names }) =>
      `${propertyKey(names.base)}: OperationTypes<${JSON.stringify(operationId)}, Client[${JSON.stringify(names.base)}]>;`,
  );

  return [
    "type MethodResult<Method> = Method extends (...args: never) => Promise<infer Result> ? Result : never;",
    `/** What a query reads from one client method: its request, call options, data (headers as a plain record) and error (${errorComment}). */\nexport interface OperationTypes<Id extends string, Method extends (...args: never) => Promise<ClientResult>> {\nrequest: Parameters<Method>[0];\ncall: NonNullable<Parameters<Method>[1]>;\ndata: ${data};\nerror: ${error};\n}`,
    "/** Any operation's types. */\nexport interface AnyOperationTypes {\nrequest: unknown;\ncall: unknown;\ndata: unknown;\nerror: unknown;\n}",
    `/** The types of each operation, read from the client. */\nexport interface ${api}Operations {\n${members.join("\n")}\n}`,
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
    '/** Options whose `call` is required: the client method requires a timeout. */\nexport type WithRequiredCall<Options extends { readonly call?: unknown }> = Options & { readonly call: NonNullable<Options["call"]> };',
  ];

  return sources.join("\n\n");
}

function resourceUnion(resources: readonly string[]): string {
  return resources.length === 0
    ? "never"
    : resources.map((type) => JSON.stringify(type)).join(" | ");
}

function nextPageConstantName(operation: QueryOperation): string {
  return `${operation.names.base.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_PAGES`;
}

function nextPageConstant(operation: QueryOperation): string[] {
  if (operation.nextPage === undefined || operation.names.infinite === undefined) return [];

  const rule: NextPageRule = operation.nextPage;

  return [
    `/** How the infinite query of \`${operation.names.base}\` builds its next page's request. */\nconst ${nextPageConstantName(operation)}: NextPageRule = ${JSON.stringify(rule)};`,
  ];
}

function factorySource(
  plan: QueryPlan,
  options: ReactQueryOptions,
  hasIdempotency: boolean,
): string {
  const api = plan.apiName;
  const keyMembers = plan.operations.flatMap((operation) => keySources(operation, api));
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
${idempotency}const keys = {
all: [ROOT] as const,
resource: (type: ${api}Resource) => [ROOT, { resource: type }] as const,
${keyMembers.join("\n")}
};

return {
keys,
${members.join(",\n\n")},
};
}

/** What \`create${api}Queries\` returns. */
export type ${api}Queries = ReturnType<typeof create${api}Queries>;`;
}

function keyPrefix(operation: QueryOperation): string {
  return operation.resource === undefined
    ? "ROOT"
    : `ROOT, { resource: ${JSON.stringify(operation.resource)} }`;
}

function keySources(operation: QueryOperation, api: string): string[] {
  if (operation.form !== "query") return [];

  const { names } = operation;
  const request = `request: ${api}Operations[${JSON.stringify(names.base)}]["request"]`;
  const filled = JSON.stringify(operation.filledHeaderKeys);
  const id = JSON.stringify(operation.operationId);
  const plain = `${propertyKey(names.base)}: (${request}) => [${keyPrefix(operation)}, ${id}, keyRequest(request, ${filled})] as const,`;

  if (names.infinite === undefined) return [plain];

  return [
    plain,
    `${propertyKey(names.infinite.key)}: (${request}) => [${keyPrefix(operation)}, ${id}, "infinite", keyRequest(request, ${filled})] as const,`,
  ];
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

function operationType(operation: QueryOperation, api: string): string {
  return `${api}Operations[${JSON.stringify(operation.names.base)}]`;
}

// The client call's result as the query data: the success or a thrown error, or the whole result.
function resultExpression(
  operation: QueryOperation,
  call: string,
  options: ReactQueryOptions,
): string {
  if (options.errors === "data") return `withPlainHeaders(${call})`;

  return `successOrThrow(${call}, (failure) => new ContractError(${JSON.stringify(operation.operationId)}, failure))`;
}

function staleTimeMember(operation: QueryOperation, options: ReactQueryOptions): string {
  return options.staleTime === "contract" ? `staleTime: ${operation.freshnessMs},\n` : "";
}

function querySource(operation: QueryOperation, api: string, options: ReactQueryOptions): string {
  const { names } = operation;
  const types = operationType(operation, api);
  const call = `await client.${names.base}(request, { ...call, signal })`;

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
  const call = `await client.${names.base}(pageParam, { ...call, signal })`;

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
