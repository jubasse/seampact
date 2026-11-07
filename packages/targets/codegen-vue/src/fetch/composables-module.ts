import {
  AS_ERROR_SOURCE,
  callerOptionsParameter,
  cellsMutationSource,
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
import type { VueQueryOptions } from "../options.js";

// The `composables.ts` of one api for plain fetch (ADR 0021 "Plain fetch"): `create<Api>Composables` returns the
// members of `create<Api>Queries` plus, per operation, a composable built on Vue's `ref` and `watch` alone. A query
// composable reads when its component mounts (at once outside a component) and when its request changes, and aborts
// when its scope is disposed and on a request change; it never reads on the server; it has no cache, so a write refreshes nothing and `refetch` reads again. A mutation composable sends one
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

const MUTATION_STATE_TYPES = `${MUTATE_OUTCOME_TYPE}

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

${mutationCallerOptionsSource("composable")}`;

// One read at a time: a new read aborts the previous one, whose answer is then dropped. In a component the first read
// waits for `onMounted`, which never runs on the server, so server rendering sends nothing.
const USE_FETCH_QUERY_SOURCE = `// Reads on mount (at once outside a component), on a request change and on \`refetch\`; the read is aborted when the
// scope is disposed and on a request change, and nothing reads after that. The request is compared by its key, so a
// new object with the same members reads nothing.
function useFetchQuery<Request, Data>(
request: MaybeRefOrGetter<Request | null>,
requestKeyOf: (request: Request) => string,
fetcher: (request: Request, signal: AbortSignal) => Promise<Data>,
): QueryState<Data, Error> {
const data = shallowRef<Data | undefined>(undefined);
const error = shallowRef<Error | undefined>(undefined);
const isLoading = shallowRef(false);
let reading: AbortController | undefined;
let disposed = false;

const abortReading = () => {
reading?.abort();
reading = undefined;
};

const read = () => {
if (disposed) return;

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

const watchRequest = () => {
watch(
requestKey,
() => {
data.value = undefined;
error.value = undefined;
read();
},
{ immediate: true },
);
};

if (getCurrentInstance() === null) watchRequest();
else onMounted(watchRequest);

if (getCurrentScope() !== undefined) {
onScopeDispose(() => {
disposed = true;
abortReading();
});
}

return { data, error, isLoading, refetch: read };
}`;

const USE_FETCH_MUTATION_SOURCE = cellsMutationSource({
  functionName: "useFetchMutation",
  memberNameParameter: "composableName",
  cellConstructor: "shallowRef",
  write: (cell, value) => `${cell}.value = ${value};`,
});

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
      ? [
          "computed",
          "getCurrentInstance",
          "getCurrentScope",
          "type MaybeRefOrGetter",
          "onMounted",
          "onScopeDispose",
        ]
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

function composableSource(operation: QueryOperation, api: string): string {
  const { names } = operation;
  const types = operationType(operation, api);
  // A required options object is read directly, an optional one through `?.`.
  const read = operation.needsTimeout ? "options." : "options?.";

  if (operation.form === "mutation") {
    return `${propertyKey(names.hook)}: (${callerOptionsParameter(operation, `MutationCallerOptions<${types}>`)}): MutationState<${types}["request"], ${types}["data"], ${types}["error"]> =>
useFetchMutation(${JSON.stringify(names.hook)}, (request: ${types}["request"], attempt: object) => queries.${names.options}(${read}call).fetcher(request, attempt), ${read}retry ?? 0),`;
  }

  const filled = JSON.stringify(operation.filledHeaderKeys);

  return `${propertyKey(names.hook)}: (request: MaybeRefOrGetter<${types}["request"] | null>, ${callerOptionsParameter(operation, `QueryCallerOptions<${types}>`)}): QueryState<${types}["data"], ${types}["error"]> =>
useFetchQuery(
request,
(current) => JSON.stringify([keyRequest(current, ${filled})]),
(current, signal) => queries.${names.options}(current, ${read}call).fetcher(signal),
),`;
}
