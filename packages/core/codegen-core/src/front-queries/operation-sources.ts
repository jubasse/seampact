import { propertyKey } from "../property-key.js";
import type { NextPageRule } from "./next-page-rule.js";
import type { QueryOperation, QueryPlan } from "./query-plan.js";

// The TypeScript source parts every front target's query modules share (ADR 0021 "The generated API", "Keys"): the
// types each operation reads from the client, the `isContractError` guard, the resource union, the next-page
// constants and the `keys` object.

/** Declared errors thrown as the client's `ContractError`, or the whole result returned as data. */
export type FrontErrors = "throw" | "data";

// `instanceof ContractError` would widen a query error's `Error` member to `ContractError<any, any>`.
export const CONTRACT_ERROR_GUARD = `/** Narrows a query or mutation error to the client's \`ContractError\` of its operation, keeping its failure type. */
export function isContractError<Thrown>(error: Thrown): error is Extract<Thrown, ContractError<string, unknown>> {
return error instanceof ContractError;
}`;

export const METHOD_RESULT_TYPE =
  "type MethodResult<Method> = Method extends (...args: never) => Promise<infer Result> ? Result : never;";

/** The specifiers a queries module imports the client and the runtime from. */
export interface QueriesImports {
  readonly client: string;
  readonly runtime: string;
}

/** Which forms the plan's operations take, so a module imports only what it uses. */
export interface PlanForms {
  readonly query: boolean;
  readonly infinite: boolean;
  readonly mutation: boolean;
  readonly idempotency: boolean;
  readonly timeout: boolean;
}

export function planForms(plan: QueryPlan): PlanForms {
  const { operations } = plan;

  return {
    query: operations.some((operation) => operation.form === "query"),
    infinite: operations.some((operation) => operation.names.infinite !== undefined),
    mutation: operations.some((operation) => operation.form === "mutation"),
    idempotency: operations.some((operation) => operation.idempotencyHeaderKey !== undefined),
    timeout: operations.some((operation) => operation.needsTimeout),
  };
}

/** Where a library keeps an operation's error: in each operation's `error` member, or in one store-wide type. */
export type ErrorMember = "perOperation" | "storeWide";

/**
 * `OperationTypes`, `AnyOperationTypes` and `<Api>Operations`: per operation its request, call options, data
 * (headers as a plain record) and, unless the library keeps one store-wide error type, its error, read from the
 * client method.
 */
export function operationTypesSource(
  api: string,
  operations: readonly QueryOperation[],
  errors: FrontErrors,
  errorMember: ErrorMember,
): string {
  const throwsErrors = errors === "throw";
  const perOperation = errorMember === "perOperation";
  const data = throwsErrors
    ? "WithPlainHeaders<SuccessOf<MethodResult<Method>>>"
    : "WithPlainHeaders<MethodResult<Method>>";
  const error = throwsErrors
    ? "ContractError<Id, FailureOf<MethodResult<Method>>> | Error"
    : "Error";
  const errorComment = throwsErrors
    ? "a declared error or an unexpected answer as the client's `ContractError`, or the client's rejection"
    : "the client's rejection (network failure, timeout or abort); declared errors are data";
  const comment = perOperation
    ? `What a query reads from one client method: its request, call options, data (headers as a plain record) and error (${errorComment}).`
    : "What an endpoint reads from one client method: its request, call options and data (headers as a plain record).";
  // The operation id types a thrown `ContractError` only; data errors leave it out, as an unused type parameter.
  const typesId = throwsErrors && perOperation;
  const idParameter = typesId ? "Id extends string, " : "";
  const errorLines = perOperation ? `error: ${error};\n` : "";
  const members = operations.map(
    ({ operationId, names }) =>
      `${propertyKey(names.base)}: OperationTypes<${typesId ? `${JSON.stringify(operationId)}, ` : ""}Client[${JSON.stringify(names.base)}]>;`,
  );

  return [
    METHOD_RESULT_TYPE,
    `/** ${comment} */\nexport interface OperationTypes<${idParameter}Method extends (...args: never) => Promise<ClientResult>> {\nrequest: Parameters<Method>[0];\ncall: NonNullable<Parameters<Method>[1]>;\ndata: ${data};\n${errorLines}}`,
    `/** Any operation's types. */\nexport interface AnyOperationTypes {\nrequest: unknown;\ncall: unknown;\ndata: unknown;\n${perOperation ? "error: unknown;\n" : ""}}`,
    `/** The types of each operation, read from the client. */\nexport interface ${api}Operations {\n${members.join("\n")}\n}`,
  ].join("\n\n");
}

export const REQUIRED_CALL_TYPE =
  '/** Options whose `call` is required: the client method requires a timeout. */\nexport type WithRequiredCall<Options extends { readonly call?: unknown }> = Options & { readonly call: NonNullable<Options["call"]> };';

// The client call's result as the query data: the success or a thrown error, or the whole result.
export function resultExpression(
  operation: QueryOperation,
  call: string,
  options: { readonly errors: FrontErrors },
): string {
  if (options.errors === "data") return `withPlainHeaders(${call})`;

  return `successOrThrow(${call}, (failure) => new ContractError(${JSON.stringify(operation.operationId)}, failure))`;
}

/** `<Api>Operations["<op>"]`. */
export function operationType(operation: QueryOperation, api: string): string {
  return `${api}Operations[${JSON.stringify(operation.names.base)}]`;
}

export function resourceUnion(resources: readonly string[]): string {
  return resources.length === 0
    ? "never"
    : resources.map((type) => JSON.stringify(type)).join(" | ");
}

/** `<Api>Resource`, the resource types the keys of the api sit under. */
export function resourceTypeSource(plan: QueryPlan): string {
  return `/** The resource types the keys of the api sit under. */\nexport type ${plan.apiName}Resource = ${resourceUnion(plan.resources)};`;
}

/** `<Api>QueriesSettings`. */
export function settingsTypeSource(api: string): string {
  return `/** The factory settings: \`idempotencyKey\` replaces \`crypto.randomUUID\` as the idempotency key generator. */\nexport interface ${api}QueriesSettings {\nreadonly idempotencyKey?: () => string;\n}`;
}

/** The operation's base name in constant case, as in `LIST_TASKS`. */
export function constantCaseOf(operation: QueryOperation): string {
  return constantCase(operation.names.base);
}

/** A camel or Pascal case name in constant case, as in `TASKS_SERVICE` for `TasksService`. */
export function constantCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

export function nextPageConstantName(operation: QueryOperation): string {
  return `${constantCaseOf(operation)}_PAGES`;
}

/** The next-page rule of each infinite query, as a module constant. */
export function nextPageConstants(operations: readonly QueryOperation[]): string[] {
  return operations.flatMap((operation) => {
    if (operation.nextPage === undefined || operation.names.infinite === undefined) return [];

    const rule: NextPageRule = operation.nextPage;

    return [
      `/** How the infinite query of \`${operation.names.base}\` builds its next page's request. */\nconst ${nextPageConstantName(operation)}: NextPageRule = ${JSON.stringify(rule)};`,
    ];
  });
}

/** The `keys` object: `all`, `resource(type)` and a member per query and infinite query. */
export function keysObjectSource(plan: QueryPlan): string {
  const api = plan.apiName;
  const members = plan.operations.flatMap((operation) => keyMemberSources(operation, api));

  return `const keys = {
all: [ROOT] as const,
resource: (type: ${api}Resource) => [ROOT, { resource: type }] as const,
${members.join("\n")}
};`;
}

function keyPrefix(operation: QueryOperation): string {
  return operation.resource === undefined
    ? "ROOT"
    : `ROOT, { resource: ${JSON.stringify(operation.resource)} }`;
}

function keyMemberSources(operation: QueryOperation, api: string): string[] {
  if (operation.form !== "query") return [];

  const { names } = operation;
  const request = `request: ${operationType(operation, api)}["request"]`;
  const filled = JSON.stringify(operation.filledHeaderKeys);
  const id = JSON.stringify(operation.operationId);
  const plain = `${propertyKey(names.base)}: (${request}) => [${keyPrefix(operation)}, ${id}, keyRequest(request, ${filled})] as const,`;

  if (names.infinite === undefined) return [plain];

  return [
    plain,
    `${propertyKey(names.infinite.key)}: (${request}) => [${keyPrefix(operation)}, ${id}, "infinite", keyRequest(request, ${filled})] as const,`,
  ];
}
