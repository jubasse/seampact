import {
  CONTRACT_ERROR_GUARD,
  constantCaseOf,
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
} from "@seampact/codegen-core";
import type { ReactQueryOptions } from "../options.js";

// The server-safe `queries.ts` of one api for SWR (ADR 0021 "SWR"): the types each operation reads from the client
// and `create<Api>Queries`, which returns `keys` and, per operation, the `{ key, fetcher }` pair `preload`, an
// `SWRConfig` `fallback` and the hooks read. It imports SWR's types only, so a server component prefetches with it.

/** The source of `queries.ts`. */
export function queriesModuleSource(
  plan: QueryPlan,
  options: ReactQueryOptions,
  root: string,
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
    ...(forms.idempotency ? ["idempotencyKeyGenerator", "withIdempotencyKey"] : []),
    "keyRequest",
    ...(forms.infinite ? ["type NextPageRule", "PageRequests"] : []),
    "type ClientResult",
    "type WithPlainHeaders",
  ];
  const clientNames = ["type Client", ...(throwsErrors ? ["ContractError"] : [])];

  return [
    [
      ...(forms.query ? ['import type { SWRConfiguration } from "swr";'] : []),
      ...(forms.infinite ? ['import type { SWRInfiniteConfiguration } from "swr/infinite";'] : []),
      ...(forms.mutation ? ['import type { SWRMutationConfiguration } from "swr/mutation";'] : []),
      `import { ${clientNames.join(", ")} } from "${imports.client}";`,
      `import { ${runtimeNames.join(", ")} } from "${imports.runtime}";`,
    ].join("\n"),
    operationTypesSource(api, operations, options.errors, "perOperation"),
    ...(throwsErrors ? [CONTRACT_ERROR_GUARD] : []),
    callerConfigTypesSource(forms),
    settingsTypeSource(api),
    resourceTypeSource(plan),
    `const ROOT = ${JSON.stringify(root)};`,
    ...nextPageConstants(operations),
    ...pageRequestsConstants(plan),
    factorySource(plan, options, forms.idempotency),
  ].join("\n\n");
}

function callerConfigTypesSource(forms: {
  readonly query: boolean;
  readonly infinite: boolean;
  readonly mutation: boolean;
}): string {
  const call = 'readonly call?: Operation["call"]';
  const sources = [
    ...(forms.query
      ? [
          `/** The caller's \`useSWR\` configuration; \`call\` passes the client's call options. */\nexport type QueryCallerConfig<Operation extends AnyOperationTypes> = SWRConfiguration<Operation["data"], Operation["error"]> & {\n${call};\n};`,
        ]
      : []),
    ...(forms.infinite
      ? [
          `/** The caller's \`useSWRInfinite\` configuration; the pages follow the contract's page facts. */\nexport type InfiniteCallerConfig<Operation extends AnyOperationTypes> = SWRInfiniteConfiguration<Operation["data"], Operation["error"]> & {\n${call};\n};`,
          `/** The key of one page of an infinite query: the infinite query's key and the page's request. */\nexport type PageKey<Operation extends AnyOperationTypes> = readonly [infiniteKey: readonly unknown[], pageRequest: Operation["request"]];`,
        ]
      : []),
    ...(forms.mutation
      ? [
          "/** The key of a mutation: the api and the operation, outside every resource, so a write never revalidates it. */\nexport type MutationKey = readonly [string, string];",
          `/** The caller's \`useSWRMutation\` configuration; its \`onSuccess\` runs after the generated refresh. */\nexport type MutationCallerConfig<Operation extends AnyOperationTypes> = SWRMutationConfiguration<Operation["data"], Operation["error"], MutationKey, Operation["request"]> & {\n${call};\n};`,
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
    ? ["const drawIdempotencyKey = idempotencyKeyGenerator(settings.idempotencyKey);"]
    : [];
  const settingsParameter = hasIdempotency ? "settings" : "_settings";
  const setup = idempotency.join("\n");

  return `/**
 * The api's keys and, per operation, the \`{ key, fetcher }\` of its query, the \`{ getKey, fetcher, hasNextPage }\` of its
 * infinite query or the \`{ key, fetcher }\` of its mutation over \`client\`, for \`preload\`, a \`fallback\` and the
 * hooks. SWR passes no abort signal: a query's request runs to its end.
 */
export function create${api}Queries(client: Client, ${settingsParameter}: ${api}QueriesSettings = {}) {
${setup === "" ? "" : `${setup}\n\n`}${keysObjectSource(plan)}

return {
keys,
${members.join(",\n\n")},
};
}

/** What \`create${api}Queries\` returns. */
export type ${api}Queries = ReturnType<typeof create${api}Queries>;`;
}

function pageRequestsName(operation: QueryOperation): string {
  return `${constantCaseOf(operation)}_PAGE_REQUESTS`;
}

// At module scope: a page is one object whoever read it, so every factory over one SWR cache finds its request.
function pageRequestsConstants(plan: QueryPlan): string[] {
  return plan.operations.flatMap((operation) =>
    operation.names.infinite === undefined
      ? []
      : [
          `/** The request each page of the infinite query of \`${operation.names.base}\` was read with. */\nconst ${pageRequestsName(operation)} = new PageRequests<${operationType(operation, plan.apiName)}["request"]>();`,
        ],
  );
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

// The call options parameter: optional, or required when the method requires a timeout.
function callParameter(operation: QueryOperation, types: string): string {
  return operation.needsTimeout ? `call: ${types}["call"]` : `call?: ${types}["call"]`;
}

function querySource(operation: QueryOperation, api: string, options: ReactQueryOptions): string {
  const { names } = operation;
  const types = operationType(operation, api);
  const call = `await client.${names.base}(request, call)`;

  return `${propertyKey(names.options)}(request: ${types}["request"], ${callParameter(operation, types)}) {
return {
key: keys.${names.base}(request),
fetcher: async (): Promise<${types}["data"]> => ${resultExpression(operation, call, options)},
};
}`;
}

// Each page's key holds the request it reads; the request of the page after one is built from the request that
// page was read with, which SWR does not hand the key loader.
function infiniteSource(
  operation: QueryOperation,
  api: string,
  options: ReactQueryOptions,
): string {
  const { names } = operation;
  const infinite = names.infinite;

  if (infinite === undefined) return "";

  const types = operationType(operation, api);
  const pages = pageRequestsName(operation);
  const call = `await client.${names.base}(pageRequest, call)`;

  return `${propertyKey(infinite.options)}(request: ${types}["request"], ${callParameter(operation, types)}) {
const pageKey = (pageRequest: ${types}["request"]): PageKey<${types}> => [keys.${infinite.key}(request), pageRequest];
const getKey = (index: number, previousPage: ${types}["data"] | null): PageKey<${types}> | null => {
if (index === 0) return pageKey(request);

if (previousPage === null) return null;

const next = ${pages}.nextAfter(${nextPageConstantName(operation)}, previousPage);

return next === undefined ? null : pageKey(next);
};
const hasNextPage = (pages: readonly ${types}["data"][] | undefined): boolean => {
const lastPage = pages?.at(-1);

return lastPage !== undefined && ${pages}.nextAfter(${nextPageConstantName(operation)}, lastPage) !== undefined;
};

return {
getKey,
hasNextPage,
fetcher: async ([, pageRequest]: PageKey<${types}>): Promise<${types}["data"]> => ${pages}.remember(${resultExpression(operation, call, options)}, pageRequest),
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
  const request =
    operation.idempotencyHeaderKey === undefined
      ? "arg"
      : `withIdempotencyKey(arg, ${JSON.stringify(operation.idempotencyHeaderKey)}, drawIdempotencyKey)`;
  const call = `await client.${names.base}(${request}, call)`;

  return `${propertyKey(names.options)}(${callParameter(operation, types)}) {
const key: MutationKey = [ROOT, ${JSON.stringify(operation.operationId)}];

return {
key,
fetcher: async (_key: MutationKey, { arg }: { readonly arg: ${types}["request"] }): Promise<${types}["data"]> => ${resultExpression(operation, call, options)},
};
}`;
}
