import type { QueryOperation, QueryPlan } from "@seampact/codegen-core";
import { propertyKey } from "@seampact/codegen-core";
import type { ReactQueryOptions } from "../options.js";
import {
  METHOD_RESULT_TYPE,
  nextPageConstantName,
  nextPageConstants,
  operationType,
  planForms,
} from "../shared/operation-sources.js";

// The `api.ts` of one api for RTK Query (ADR 0021 "RTK Query"): `create<Api>Api(client, settings?)` over `createApi`
// and `fakeBaseQuery`, an endpoint per operation whose `queryFn` calls the client with RTK's signal, resource types
// as tags. The store holds plain values only: a failure is returned as a plain `{ error }` discriminated by `kind`,
// and `toContractError` turns a `contract` one back into the client's class. RTK's hooks unsubscribe on unmount and
// never abort a request, and a mutation over `fakeBaseQuery` has no retry: each call draws a new idempotency key.

const HOOKS_MODULE = "@reduxjs/toolkit/query/react";
const CORE_MODULE = "@reduxjs/toolkit/query";
const CLIENT_DIRECTIVE = '"use client";';

/** The names the api module imports from the client and the runtime, by the module specifier. */
export interface ApiImports {
  readonly client: string;
  readonly runtime: string;
}

/** Whether the module carries RTK's React hooks. */
export type RtkHooks = "hooks" | "noHooks";

/** The source of `api.ts`. */
export function apiModuleSource(
  plan: QueryPlan,
  options: ReactQueryOptions,
  reducerPath: string,
  hooks: RtkHooks,
  imports: ApiImports,
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

  return [
    ...(withHooks && options.useClientDirective === "on" ? [CLIENT_DIRECTIVE] : []),
    [
      `import { createApi, fakeBaseQuery } from "${withHooks ? HOOKS_MODULE : CORE_MODULE}";`,
      `import { ${clientNames.join(", ")} } from "${imports.client}";`,
      `import { ${runtimeNames.join(", ")} } from "${imports.runtime}";`,
    ].join("\n"),
    operationTypesSource(plan, throwsErrors),
    failureTypeSource(plan, throwsErrors),
    ...(throwsErrors ? [TO_CONTRACT_ERROR] : []),
    ...(forms.timeout ? [TIMED_ARG_TYPE] : []),
    `/** The api settings: the store slice's \`reducerPath\` (the api id by default), and \`idempotencyKey\`, which replaces \`crypto.randomUUID\` as the idempotency key generator. */\nexport interface ${api}ApiSettings {\nreadonly reducerPath?: string;\nreadonly idempotencyKey?: () => string;\n}`,
    `const DEFAULT_REDUCER_PATH = ${JSON.stringify(reducerPath)};`,
    ...nextPageConstants(plan.operations),
    factorySource(plan, options, forms.idempotency),
  ].join("\n\n");
}

const TO_CONTRACT_ERROR = `/** The client's \`ContractError\` of a \`contract\` failure, as the client would have thrown it (headers as a plain record). */
export function toContractError<Operation extends string, Failure>(failure: ContractFailure<Operation, Failure>): ContractError<Operation, Failure> {
return new ContractError(failure.operation, failure.failure);
}`;

const TIMED_ARG_TYPE = `/** The argument of an endpoint whose client method requires a timeout: the request and the call options. */
export interface TimedArg<Operation extends AnyOperationTypes> {
readonly request: Operation["request"];
readonly call: Omit<Operation["call"], "signal">;
}`;

function operationTypesSource(plan: QueryPlan, throwsErrors: boolean): string {
  const data = throwsErrors
    ? "WithPlainHeaders<SuccessOf<MethodResult<Method>>>"
    : "WithPlainHeaders<MethodResult<Method>>";
  const members = plan.operations.map(
    ({ names }) =>
      `${propertyKey(names.base)}: OperationTypes<Client[${JSON.stringify(names.base)}]>;`,
  );

  return [
    METHOD_RESULT_TYPE,
    `/** What an endpoint reads from one client method: its request, call options and data (headers as a plain record). */\nexport interface OperationTypes<Method extends (...args: never) => Promise<ClientResult>> {\nrequest: Parameters<Method>[0];\ncall: NonNullable<Parameters<Method>[1]>;\ndata: ${data};\n}`,
    "/** Any operation's types. */\nexport interface AnyOperationTypes {\nrequest: unknown;\ncall: unknown;\ndata: unknown;\n}",
    `/** The types of each operation, read from the client. */\nexport interface ${plan.apiName}Operations {\n${members.join("\n")}\n}`,
  ].join("\n\n");
}

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

function tagsMember(operation: QueryOperation, member: "providesTags" | "invalidatesTags"): string {
  return operation.resource === undefined
    ? ""
    : `\n${member}: [${JSON.stringify(operation.resource)}],`;
}

function querySource(operation: QueryOperation, api: string, options: ReactQueryOptions): string {
  const { names } = operation;
  const types = operationType(operation, api);
  const call = `client.${names.base}(${requestOf(operation, "arg")}, ${callOf(operation, "arg")})`;

  return `${propertyKey(names.base)}: build.query<${types}["data"], ${argType(operation, types)}>({
queryFn: (arg, { signal }) => ${settled(operation, call, options)},${tagsMember(operation, "providesTags")}
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

  return `${propertyKey(infinite.key)}: build.infiniteQuery<${types}["data"], ${argType(operation, types)}, ${types}["request"] | null>({
infiniteQueryOptions: {
initialPageParam: null,
getNextPageParam: (lastPage, _pages, lastPageParam, _pageParams, queryArg) => nextPageRequest(${nextPageConstantName(operation)}, lastPageParam ?? ${firstRequest}, lastPage),
},
queryFn: ({ queryArg, pageParam }, { signal }) => ${settled(operation, call, options)},${tagsMember(operation, "providesTags")}
}),`;
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
  const tags = options.invalidate === "resource" ? tagsMember(operation, "invalidatesTags") : "";

  return `${propertyKey(names.base)}: build.mutation<${types}["data"], ${argType(operation, types)}>({
queryFn: (arg, { signal }) => ${settled(operation, call, options)},${tags}
}),`;
}
