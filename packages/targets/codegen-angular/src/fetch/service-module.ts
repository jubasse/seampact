import {
  AS_ERROR_SOURCE,
  callerOptionsParameter,
  cellsMutationSource,
  constantCase,
  isRetryableSource,
  MUTATE_OUTCOME_TYPE,
  mutationCallerOptionsSource,
  operationType,
  planForms,
  propertyKey,
  type QueryOperation,
  type QueryPlan,
  REQUIRED_CALL_TYPE,
} from "@seampact/codegen-core";
import type { AngularQueryOptions } from "../options.js";

// The `service.ts` of one api for plain fetch (ADR 0021 "Angular"): the `<Api>Api` service, provided by
// `provide<Api>Api(config)`, whose client sends through the app's `HttpClient`, and per operation a member: a query
// returns a reader built on Angular's `resource()`, which reads when its request changes and aborts when its injector
// is destroyed and on a request change, and never reads during server rendering unless given a `transferId`; it has
// no cache, so a write refreshes nothing and `refetch` reads again. A mutation member sends one idempotency key per
// `mutate`, kept across the retries its `retry` option asks for.

/** The members of the service the operations' members sit beside, so no operation takes one of their names. */
export const SERVICE_OWN_MEMBERS = ["client", "queries"];

const QUERY_STATE_TYPES = `/** What a query member returns: the last data and error of its request as signals, and \`refetch\` to read it again. */
export interface QueryReader<Data, Failure> {
readonly data: Signal<Data | undefined>;
readonly error: Signal<Failure | undefined>;
readonly isLoading: Signal<boolean>;
readonly refetch: () => void;
}

/**
 * The caller's query options: \`call\` passes the client's call options, its \`signal\` aborting the read too;
 * \`injector\` places a reader created outside an injection context; \`transferId\` reads during server rendering and
 * hands the data to the browser under that id, which must be the same on both sides.
 */
export interface QueryCallerOptions<Operation extends AnyOperationTypes> {
readonly call?: Operation["call"];
readonly injector?: Injector;
readonly transferId?: string;
}`;

const MUTATION_STATE_TYPES = `${MUTATE_OUTCOME_TYPE}

/**
 * What a mutation member returns: \`mutate\` sends a request and resolves to its own outcome, never rejecting; the
 * signals show the latest call.
 */
export interface MutationState<Request, Data, Failure> {
readonly mutate: (request: Request) => Promise<MutateOutcome<Data, Failure>>;
readonly isPending: Signal<boolean>;
readonly error: Signal<Failure | undefined>;
readonly data: Signal<Data | undefined>;
}

${mutationCallerOptionsSource("member")}`;

// The request is compared by its key, so a new object with the same members reads nothing. On the server the
// request stays absent, so `resource()` stays idle, unless the caller opts in with a `transferId`.
const FETCH_READER_SOURCE = `// Reads when its request is set or changes and on \`refetch\`; the read is aborted when the injector is destroyed and
// on a request change, and nothing reads after that. A \`null\` request sends nothing.
function fetchReader<Request, Data>(
request: () => Request | null,
requestKeyOf: (request: Request) => string,
fetcher: (request: Request, signal: AbortSignal) => Promise<Data>,
options: { readonly injector?: Injector | undefined; readonly transferId?: string | undefined },
): QueryReader<Data, Error> {
const injector = options.injector ?? inject(Injector);
const readsHere = options.transferId !== undefined || !isPlatformServer(injector.get(PLATFORM_ID));
const params = computed(() => (readsHere ? (request() ?? undefined) : undefined), {
equal: (left, right) => (left === undefined || right === undefined ? left === right : requestKeyOf(left) === requestKeyOf(right)),
});
const reading = resource({
params,
loader: ({ params: current, abortSignal }) => fetcher(current, abortSignal),
injector,
...(options.transferId === undefined ? {} : { id: options.transferId }),
});
const data = computed(() => (reading.hasValue() ? reading.value() : undefined));

return {
data,
error: reading.error,
isLoading: reading.isLoading,
refetch: () => {
reading.reload();
},
};
}`;

const FETCH_MUTATION_SOURCE = cellsMutationSource({
  functionName: "fetchMutation",
  memberNameParameter: "memberName",
  cellConstructor: "signal",
  write: (cell, value) => `${cell}.set(${value});`,
});

/** The specifiers `service.ts` imports the client, the queries module, the runtime and the HttpClient fetch from. */
export interface ServiceImports {
  readonly client: string;
  readonly queries: string;
  readonly runtime: string;
  readonly httpClientFetch: string;
}

/** The source of `service.ts`. */
export function serviceModuleSource(
  plan: QueryPlan,
  options: AngularQueryOptions,
  imports: ServiceImports,
): string {
  const api = plan.apiName;
  const forms = planForms(plan);
  const throwsErrors = options.errors === "throw";
  const queriesNames = [
    `create${api}Queries`,
    ...(throwsErrors && forms.mutation ? ["isContractError"] : []),
    "type AnyOperationTypes",
    `type ${api}Operations`,
    `type ${api}Queries`,
  ];
  const angularNames = [
    ...(forms.query ? ["computed"] : []),
    "inject",
    "InjectionToken",
    ...(forms.query ? ["Injector", "PLATFORM_ID"] : []),
    "type Provider",
    ...(forms.query ? ["resource"] : []),
    "type Signal",
    ...(forms.mutation ? ["signal"] : []),
  ];
  const members = plan.operations.map((operation) => memberSource(operation, api));
  const configToken = `${constantCase(api)}_API_CONFIG`;

  return [
    [
      ...(forms.query ? [`import { isPlatformServer } from "@angular/common";`] : []),
      `import { HttpClient } from "@angular/common/http";`,
      `import { ${angularNames.join(", ")} } from "@angular/core";`,
      `import { type Client, createClient } from "${imports.client}";`,
      `import { httpClientFetch } from "${imports.httpClientFetch}";`,
      `import { ${queriesNames.join(", ")} } from "${imports.queries}";`,
      ...(forms.query ? [`import { keyRequest } from "${imports.runtime}";`] : []),
    ].join("\n"),
    ...(forms.query ? [QUERY_STATE_TYPES] : []),
    ...(forms.mutation ? [MUTATION_STATE_TYPES] : []),
    ...(forms.timeout ? [REQUIRED_CALL_TYPE] : []),
    ...(forms.mutation ? [AS_ERROR_SOURCE, isRetryableSource(throwsErrors)] : []),
    ...(forms.query ? [FETCH_READER_SOURCE] : []),
    ...(forms.mutation ? [FETCH_MUTATION_SOURCE] : []),
    `/** The settings of \`${api}Api\`: the client's, without \`fetch\`, which is the app's \`HttpClient\`. */
export type ${api}ApiConfig = Omit<Parameters<typeof createClient>[0], "fetch">;

/** The token \`provide${api}Api\` sets the config under. */
export const ${configToken} = new InjectionToken<${api}ApiConfig>(${JSON.stringify(`${api}ApiConfig`)});

/** The providers of \`${api}Api\`, to list in the app's or a route's providers beside \`provideHttpClient()\`. */
export function provide${api}Api(config: ${api}ApiConfig): Provider[] {
return [
{ provide: ${configToken}, useValue: config },
{ provide: ${api}Api, useFactory: () => new ${api}Api() },
];
}`,
    `/**
 * The api's client over the app's \`HttpClient\`, the fetchers of \`create${api}Queries\`, and a member per operation.
 * Inject it with \`inject(${api}Api)\` once \`provide${api}Api\` is listed; call a query member in an injection context
 * (a field initializer) or pass its \`injector\`.
 */
export class ${api}Api {
readonly client: Client;
readonly queries: ${api}Queries;

constructor() {
const config = inject(${configToken});

this.client = createClient({ ...config, fetch: httpClientFetch(inject(HttpClient)) });
this.queries = create${api}Queries(this.client, config.idempotencyKey === undefined ? {} : { idempotencyKey: config.idempotencyKey });
}

${members.join("\n\n")}
}`,
  ].join("\n\n");
}

function memberSource(operation: QueryOperation, api: string): string {
  const { names } = operation;
  const types = operationType(operation, api);
  // A required options object is read directly, an optional one through `?.`.
  const read = operation.needsTimeout ? "options." : "options?.";

  if (operation.form === "mutation") {
    return `${propertyKey(names.base)}(${callerOptionsParameter(operation, `MutationCallerOptions<${types}>`)}): MutationState<${types}["request"], ${types}["data"], ${types}["error"]> {
return fetchMutation(${JSON.stringify(names.base)}, (request: ${types}["request"], attempt: object) => this.queries.${names.options}(${read}call).fetcher(request, attempt), ${read}retry ?? 0);
}`;
  }

  const filled = JSON.stringify(operation.filledHeaderKeys);

  return `${propertyKey(names.base)}(request: () => ${types}["request"] | null, ${callerOptionsParameter(operation, `QueryCallerOptions<${types}>`)}): QueryReader<${types}["data"], ${types}["error"]> {
return fetchReader(
request,
(current) => JSON.stringify([keyRequest(current, ${filled})]),
(current, signal) => this.queries.${names.options}(current, ${read}call).fetcher(signal),
{ injector: ${read}injector, transferId: ${read}transferId },
);
}`;
}
