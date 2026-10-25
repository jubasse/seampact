import {
  planForms,
  propertyKey,
  type QueryOperation,
  type QueryPlan,
  REQUIRED_CALL_TYPE,
} from "@seampact/codegen-core";
import type { VueQueryOptions } from "../options.js";

// The `composables.ts` of one api for plain fetch (ADR 0021 "Plain fetch"): `create<Api>Composables` returns the
// members of `create<Api>Queries` plus, per operation, a composable built on Vue's `ref` and `watch` alone. A query
// composable reads at once and when its request changes, and aborts when its scope is disposed and on a request
// change; it has no cache, so a write refreshes nothing and `refetch` reads again. A mutation composable sends one
// idempotency key per `mutate`, kept across the retries its `retry` option asks for.

const QUERY_STATE_TYPES = `/** What a query composable returns: the last data and error of its request as refs, and \`refetch\` to read it again. */
export interface QueryState<Data, Failure> {
readonly data: Readonly<Ref<Data | undefined>>;
readonly error: Readonly<Ref<Failure | undefined>>;
readonly isLoading: Readonly<Ref<boolean>>;
readonly refetch: () => void;
}

/** The caller's query composable options; \`call\` passes the client's call options, its \`signal\` aborting the read too. */
export interface QueryCallerOptions<Operation extends AnyOperationTypes> {
readonly call?: Operation["call"];
}`;

const MUTATION_STATE_TYPES = `/** What one \`mutate\` call resolves to: its data, or its error. */
export type MutateOutcome<Data, Failure> = { readonly data: Data; readonly error: undefined } | { readonly data: undefined; readonly error: Failure };

/**
 * What a mutation composable returns: \`mutate\` sends a request and resolves to its own outcome, never rejecting; the
 * refs show the latest call.
 */
export interface MutationState<Request, Data, Failure> {
readonly mutate: (request: Request) => Promise<MutateOutcome<Data, Failure>>;
readonly isPending: Readonly<Ref<boolean>>;
readonly error: Readonly<Ref<Failure | undefined>>;
readonly data: Readonly<Ref<Data | undefined>>;
}

/** The caller's mutation composable options: \`retry\`, a whole count, sends a rejected write again that many times, with the same idempotency key. */
export interface MutationCallerOptions<Operation extends AnyOperationTypes> {
readonly call?: Operation["call"];
readonly retry?: number;
}`;

const AS_ERROR_SOURCE = `// A rejection as an \`Error\`, the value kept as its cause when it is not one.
function asError(rejection: unknown): Error {
return rejection instanceof Error ? rejection : new Error(String(rejection), { cause: rejection });
}`;

// One read at a time: a new read aborts the previous one, whose answer is then dropped.
const USE_FETCH_QUERY_SOURCE = `// Reads at once, on a request change and on \`refetch\`; the read is aborted when the scope is disposed and on a
// request change. The request is compared by its key, so a new object with the same members reads nothing.
function useFetchQuery<Request, Data>(
request: MaybeRefOrGetter<Request | null>,
requestKeyOf: (request: Request) => string,
fetcher: (request: Request, signal: AbortSignal) => Promise<Data>,
): QueryState<Data, Error> {
const data = shallowRef<Data | undefined>(undefined);
const error = shallowRef<Error | undefined>(undefined);
const isLoading = shallowRef(false);
let reading: AbortController | undefined;

const abortReading = () => {
reading?.abort();
reading = undefined;
};

const read = () => {
const current = toValue(request);

abortReading();

if (current === null) {
isLoading.value = false;

return;
}

const controller = new AbortController();

reading = controller;
isLoading.value = true;
fetcher(current, controller.signal).then(
(next) => {
if (controller.signal.aborted) return;

data.value = next;
error.value = undefined;
isLoading.value = false;
},
(rejection: unknown) => {
if (controller.signal.aborted) return;

error.value = asError(rejection);
isLoading.value = false;
},
);
};

const requestKey = computed(() => {
const current = toValue(request);

return current === null ? null : requestKeyOf(current);
});

watch(
requestKey,
() => {
data.value = undefined;
error.value = undefined;
read();
},
{ immediate: true },
);

if (getCurrentScope() !== undefined) onScopeDispose(abortReading);

return { data, error, isLoading, refetch: read };
}`;

// One fetcher and one attempt object per `mutate`, passed to each retry, so the retries keep one idempotency key;
// only the latest `mutate` writes the refs, and every call resolves to its own outcome. A write is not aborted when
// the scope is disposed.
const USE_FETCH_MUTATION_SOURCE = `function useFetchMutation<Request, Data>(
composableName: string,
fetcher: (request: Request, attempt: object) => Promise<Data>,
retry: number,
): MutationState<Request, Data, Error> {
if (!Number.isInteger(retry) || retry < 0) {
throw new Error(\`\${composableName}: the option retry is \${retry}, not a whole count of retries; pass 0 or more.\`);
}

const data = shallowRef<Data | undefined>(undefined);
const error = shallowRef<Error | undefined>(undefined);
const isPending = shallowRef(false);
let latestMutate = 0;

const mutate = async (request: Request): Promise<MutateOutcome<Data, Error>> => {
const mutateNumber = latestMutate + 1;
const attempt = {};
const settle = (nextData: Data | undefined, nextError: Error | undefined) => {
if (latestMutate !== mutateNumber) return;

data.value = nextData;
error.value = nextError;
isPending.value = false;
};

latestMutate = mutateNumber;
data.value = undefined;
error.value = undefined;
isPending.value = true;

for (let retriesLeft = retry; ; retriesLeft -= 1) {
try {
const answer = await fetcher(request, attempt);

settle(answer, undefined);

return { data: answer, error: undefined };
} catch (rejection) {
const failure = asError(rejection);

if (retriesLeft <= 0 || !isRetryable(failure)) {
settle(undefined, failure);

return { data: undefined, error: failure };
}
}
}
};

return { mutate, isPending, error, data };
}`;

const ABORT_ERROR_NAME = "AbortError";

/** The source of `composables.ts`; `imports` holds the specifiers of the client, the queries module and the runtime. */
export function composablesModuleSource(
  plan: QueryPlan,
  options: VueQueryOptions,
  imports: { readonly client: string; readonly queries: string; readonly runtime: string },
): string {
  const api = plan.apiName;
  const forms = planForms(plan);
  const throwsErrors = options.errors === "throw";
  const queriesNames = [
    `create${api}Queries`,
    ...(throwsErrors && forms.mutation ? ["isContractError"] : []),
    "type AnyOperationTypes",
    `type ${api}Operations`,
    `type ${api}QueriesSettings`,
  ];
  const vueNames = [
    ...(forms.query
      ? ["computed", "getCurrentScope", "type MaybeRefOrGetter", "onScopeDispose"]
      : []),
    "type Ref",
    "shallowRef",
    ...(forms.query ? ["toValue", "watch"] : []),
  ];
  const composables = plan.operations.map((operation) => composableSource(operation, api));

  return [
    [
      `import { ${vueNames.join(", ")} } from "vue";`,
      `import type { Client } from "${imports.client}";`,
      `import { ${queriesNames.join(", ")} } from "${imports.queries}";`,
      ...(forms.query ? [`import { keyRequest } from "${imports.runtime}";`] : []),
    ].join("\n"),
    ...(forms.query ? [QUERY_STATE_TYPES] : []),
    ...(forms.mutation ? [MUTATION_STATE_TYPES] : []),
    ...(forms.timeout ? [REQUIRED_CALL_TYPE] : []),
    AS_ERROR_SOURCE,
    ...(forms.mutation ? [isRetryableSource(throwsErrors)] : []),
    ...(forms.query ? [USE_FETCH_QUERY_SOURCE] : []),
    ...(forms.mutation ? [USE_FETCH_MUTATION_SOURCE] : []),
    `/** The members of \`create${api}Queries\` and a composable per operation; bind the result to a PascalCase name (\`${api}\`). */
export function create${api}Composables(client: Client, settings: ${api}QueriesSettings = {}) {
const queries = create${api}Queries(client, settings);

return {
...queries,
${composables.join("\n\n")}
};
}`,
    `/** What \`create${api}Composables\` returns. */\nexport type ${api}Composables = ReturnType<typeof create${api}Composables>;`,
  ].join("\n\n");
}

// A declared error is the server's answer and an abort the caller's choice: only another rejection is sent again.
function isRetryableSource(throwsErrors: boolean): string {
  const declared = throwsErrors ? "!isContractError(error) && " : "";

  return `function isRetryable(error: Error): boolean {
return ${declared}error.name !== ${JSON.stringify(ABORT_ERROR_NAME)};
}`;
}

// The options parameter, required when the client method requires a timeout.
function optionsParameter(operation: QueryOperation, type: string): string {
  return operation.needsTimeout ? `options: WithRequiredCall<${type}>` : `options?: ${type}`;
}

function composableSource(operation: QueryOperation, api: string): string {
  const { names } = operation;
  const types = `${api}Operations[${JSON.stringify(names.base)}]`;
  // A required options object is read directly, an optional one through `?.`.
  const read = operation.needsTimeout ? "options." : "options?.";

  if (operation.form === "mutation") {
    return `${propertyKey(names.hook)}: (${optionsParameter(operation, `MutationCallerOptions<${types}>`)}): MutationState<${types}["request"], ${types}["data"], ${types}["error"]> =>
useFetchMutation(${JSON.stringify(names.hook)}, (request: ${types}["request"], attempt: object) => queries.${names.options}(${read}call).fetcher(request, attempt), ${read}retry ?? 0),`;
  }

  const filled = JSON.stringify(operation.filledHeaderKeys);

  return `${propertyKey(names.hook)}: (request: MaybeRefOrGetter<${types}["request"] | null>, ${optionsParameter(operation, `QueryCallerOptions<${types}>`)}): QueryState<${types}["data"], ${types}["error"]> =>
useFetchQuery(
request,
(current) => JSON.stringify([keyRequest(current, ${filled})]),
(current, signal) => queries.${names.options}(current, ${read}call).fetcher(signal),
),`;
}
