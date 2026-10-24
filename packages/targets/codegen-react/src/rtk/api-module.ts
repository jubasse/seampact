import type { QueryOperation, QueryPlan, Refusal } from "@seampact/codegen-core";
import { propertyKey } from "@seampact/codegen-core";
import type { ReactQueryOptions } from "../options.js";
import {
  CLIENT_DIRECTIVE,
  nextPageConstantName,
  nextPageConstants,
  operationType,
  operationTypesSource,
  planForms,
  type QueriesImports,
} from "../shared/operation-sources.js";

// The `api.ts` of one api for RTK Query (ADR 0021 "RTK Query"): `create<Api>Api(client, settings?)` over `createApi`
// and `fakeBaseQuery`, an endpoint per operation whose `queryFn` calls the client with RTK's signal, resource types
// as tags. The store holds plain values only: a failure is returned as a plain `{ error }` discriminated by `kind`,
// and `toContractError` turns a `contract` one back into the client's class. RTK's hooks unsubscribe on unmount and
// never abort a request, and a mutation over `fakeBaseQuery` has no retry: each call draws a new idempotency key. A
// mutation invalidates its resource's tags on success only; the infinite query of an operation is its `<op>Pages`
// endpoint (`use<Op>PagesInfiniteQuery`). An endpoint whose method requires a timeout takes `{ request, call }`, its
// cache key read from the request alone; an optional timeout has no place in RTK's hooks and is not passed.

const HOOKS_MODULE = "@reduxjs/toolkit/query/react";
const CORE_MODULE = "@reduxjs/toolkit/query";
const PAGES_SUFFIX = "Pages";

/** Whether the module carries RTK's React hooks. */
export type RtkHooks = "hooks" | "noHooks";

/** The source of `api.ts`. */
export function apiModuleSource(
  plan: QueryPlan,
  options: ReactQueryOptions,
  reducerPath: string,
  hooks: RtkHooks,
  imports: QueriesImports,
): string {
  const api = plan.apiName;
  const forms = planForms(plan);
  const throwsErrors = options.errors === "throw";
  const runtimeNames = [
    ...(throwsErrors
      ? ["type ContractFailure", "type FailureOf", "type SuccessOf", "settleForStore"]
      : ["settleAsData"]),
    ...(forms.idempotency ? ["idempotencyKeyGenerator", "withIdempotencyKey"] : []),
    ...(forms.infinite ? ["type NextPageRule", "nextPageRequest"] : []),
    "type ClientResult",
    "type PlainRejection",
    "type WithPlainHeaders",
  ];
  const clientNames = ["type Client", ...(throwsErrors ? ["ContractError"] : [])];
  const withHooks = hooks === "hooks";
  const rtkNames = [
    "createApi",
    ...(plan.operations.some((operation) => operation.form === "query" && operation.needsTimeout)
      ? ["defaultSerializeQueryArgs"]
      : []),
    "fakeBaseQuery",
  ];

  return [
    ...(withHooks && options.useClientDirective === "on" ? [CLIENT_DIRECTIVE] : []),
    [
      `import { ${rtkNames.join(", ")} } from "${withHooks ? HOOKS_MODULE : CORE_MODULE}";`,
      `import { ${clientNames.join(", ")} } from "${imports.client}";`,
      `import { ${runtimeNames.join(", ")} } from "${imports.runtime}";`,
    ].join("\n"),
    operationTypesSource(api, plan.operations, options.errors, "storeWide"),
    failureTypeSource(plan, throwsErrors),
    ...(throwsErrors ? [TO_CONTRACT_ERROR] : []),
    ...(forms.timeout ? [TIMED_ARG_TYPE] : []),
    `/** The api settings: the store slice's \`reducerPath\` (the api id by default), and \`idempotencyKey\`, which replaces \`crypto.randomUUID\` as the idempotency key generator. */\nexport interface ${api}ApiSettings {\nreadonly reducerPath?: string;\nreadonly idempotencyKey?: () => string;\n}`,
    `const DEFAULT_REDUCER_PATH = ${JSON.stringify(reducerPath)};`,
    ...nextPageConstants(plan.operations),
    factorySource(plan, options, forms.idempotency),
  ].join("\n\n");
}

// Distributed over the failure union, so a value narrowed to one operation keeps its operation's failure type.
const TO_CONTRACT_ERROR = `/** The client's \`ContractError\` of a \`contract\` failure, as the client would have thrown it (headers as a plain record). */
export function toContractError<Failure extends ContractFailure<string, unknown>>(failure: Failure): Failure extends ContractFailure<infer Operation extends string, infer Declared> ? ContractError<Operation, Declared> : never;
export function toContractError(failure: ContractFailure<string, unknown>): ContractError<string, unknown> {
return new ContractError(failure.operation, failure.failure);
}`;

const TIMED_ARG_TYPE = `/** The argument of an endpoint whose client method requires a timeout: the request and the call options. */
export interface TimedArg<Operation extends AnyOperationTypes> {
readonly request: Operation["request"];
readonly call: Omit<Operation["call"], "signal">;
}`;

// `fakeBaseQuery` types one error for the whole api: the union over the operations, discriminated by `kind`.
function failureTypeSource(plan: QueryPlan, throwsErrors: boolean): string {
  const api = plan.apiName;

  if (!throwsErrors) {
    return `/** The plain error of every endpoint: a network failure, a timeout or an abort; declared errors are data. */\nexport type ${api}Failure = PlainRejection;`;
  }

  const contractFailures = plan.operations.map(
    ({ operationId, names }) =>
      `| ContractFailure<${JSON.stringify(operationId)}, WithPlainHeaders<FailureOf<MethodResult<Client[${JSON.stringify(names.base)}]>>>>`,
  );

  return `/** The plain error of every endpoint: a declared error or an unexpected answer (\`contract\`), or a network failure, a timeout or an abort (\`rejection\`). */\nexport type ${api}Failure =\n${[...contractFailures, "| PlainRejection"].join("\n")};`;
}

function factorySource(
  plan: QueryPlan,
  options: ReactQueryOptions,
  hasIdempotency: boolean,
): string {
  const api = plan.apiName;
  const endpoints = plan.operations.flatMap((operation) =>
    endpointSources(operation, api, options),
  );
  const idempotency = hasIdempotency
    ? "const drawIdempotencyKey = idempotencyKeyGenerator(settings.idempotencyKey);\n\n"
    : "";
  const tagTypes =
    plan.resources.length === 0
      ? ""
      : `tagTypes: [${plan.resources.map((type) => JSON.stringify(type)).join(", ")}],\n`;

  return `/** The RTK Query api over \`client\`: an endpoint per operation, the hooks keeping RTK's own names. */
export function create${api}Api(client: Client, settings: ${api}ApiSettings = {}) {
${idempotency}return createApi({
reducerPath: settings.reducerPath ?? DEFAULT_REDUCER_PATH,
baseQuery: fakeBaseQuery<${api}Failure>(),
${tagTypes}endpoints: (build) => ({
${endpoints.join("\n\n")}
}),
});
}

/** What \`create${api}Api\` returns. */
export type ${api}Api = ReturnType<typeof create${api}Api>;`;
}

function endpointSources(
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

// The endpoint's argument: the request, or the request and the call options when the method requires a timeout.
function argType(operation: QueryOperation, types: string): string {
  return operation.needsTimeout ? `TimedArg<${types}>` : `${types}["request"]`;
}

function requestOf(operation: QueryOperation, arg: string): string {
  return operation.needsTimeout ? `${arg}.request` : arg;
}

function callOf(operation: QueryOperation, arg: string): string {
  return operation.needsTimeout ? `{ ...${arg}.call, signal }` : "{ signal }";
}

// The client call settled into the store's plain data or error.
function settled(operation: QueryOperation, call: string, options: ReactQueryOptions): string {
  return options.errors === "data"
    ? `settleAsData(${call})`
    : `settleForStore(${JSON.stringify(operation.operationId)}, ${call})`;
}

function providesTagsMember(operation: QueryOperation): string {
  return operation.resource === undefined
    ? ""
    : `\nprovidesTags: [${JSON.stringify(operation.resource)}],`;
}

// RTK invalidates on a rejected mutation too, and every returned `{ error }` is one: a failed write refreshes nothing.
function invalidatesTagsMember(operation: QueryOperation): string {
  return operation.resource === undefined
    ? ""
    : `\ninvalidatesTags: (_result, error) => (error === undefined ? [${JSON.stringify(operation.resource)}] : []),`;
}

// A timed endpoint's cache key is its request's: two timeouts for one request are one entry.
function cacheKeyMember(operation: QueryOperation): string {
  return operation.needsTimeout
    ? "\nserializeQueryArgs: ({ queryArgs, endpointDefinition, endpointName }) => defaultSerializeQueryArgs({ queryArgs: queryArgs.request, endpointDefinition, endpointName }),"
    : "";
}

function querySource(operation: QueryOperation, api: string, options: ReactQueryOptions): string {
  const { names } = operation;
  const types = operationType(operation, api);
  const call = `client.${names.base}(${requestOf(operation, "arg")}, ${callOf(operation, "arg")})`;

  return `${propertyKey(names.base)}: build.query<${types}["data"], ${argType(operation, types)}>({
queryFn: (arg, { signal }) => ${settled(operation, call, options)},${providesTagsMember(operation)}${cacheKeyMember(operation)}
}),`;
}

// The page param is the page's request; the first page's is null and reads the argument's own request.
function infiniteSource(
  operation: QueryOperation,
  api: string,
  options: ReactQueryOptions,
): string {
  const { names } = operation;
  const infinite = names.infinite;

  if (infinite === undefined) return "";

  const types = operationType(operation, api);
  const firstRequest = requestOf(operation, "queryArg");
  const call = `client.${names.base}(pageParam ?? ${firstRequest}, ${callOf(operation, "queryArg")})`;

  return `${propertyKey(pagesEndpointName(operation))}: build.infiniteQuery<${types}["data"], ${argType(operation, types)}, ${types}["request"] | null>({
infiniteQueryOptions: {
initialPageParam: null,
getNextPageParam: (lastPage, _pages, lastPageParam, _pageParams, queryArg) => nextPageRequest(${nextPageConstantName(operation)}, lastPageParam ?? ${firstRequest}, lastPage),
},
queryFn: ({ queryArg, pageParam }, { signal }) => ${settled(operation, call, options)},${providesTagsMember(operation)}${cacheKeyMember(operation)}
}),`;
}

/** Each `<op>Pages` endpoint whose name is already another operation's endpoint, refused by name. */
export function refusePagesEndpointCollisions(plan: QueryPlan): Refusal[] {
  const endpointNames = new Set(plan.operations.map((operation) => operation.names.base));

  return plan.operations.flatMap((operation) => {
    const pages = pagesEndpointName(operation);

    if (operation.names.infinite === undefined || !endpointNames.has(pages)) return [];

    return [
      {
        code: "names.collision",
        message: `The RTK Query endpoint '${pages}', the infinite query of the operation '${operation.operationId}', is already the endpoint of another operation.`,
        fix: "Rename one of the two operations in the contract so that their generated names differ, or set 'infinite: off'.",
        member: "",
        operation: operation.operationId,
      },
    ];
  });
}

/** The endpoint of an operation's infinite query: `<op>Pages`, so RTK names its hook `use<Op>PagesInfiniteQuery`. */
export function pagesEndpointName(operation: QueryOperation): string {
  return `${operation.names.base}${PAGES_SUFFIX}`;
}

function mutationSource(
  operation: QueryOperation,
  api: string,
  options: ReactQueryOptions,
): string {
  const { names } = operation;
  const types = operationType(operation, api);
  const request = requestOf(operation, "arg");
  const keyed =
    operation.idempotencyHeaderKey === undefined
      ? request
      : `withIdempotencyKey(${request}, ${JSON.stringify(operation.idempotencyHeaderKey)}, drawIdempotencyKey)`;
  const call = `client.${names.base}(${keyed}, ${callOf(operation, "arg")})`;
  const tags = options.invalidate === "resource" ? invalidatesTagsMember(operation) : "";

  return `${propertyKey(names.base)}: build.mutation<${types}["data"], ${argType(operation, types)}>({
queryFn: (arg, { signal }) => ${settled(operation, call, options)},${tags}
}),`;
}
