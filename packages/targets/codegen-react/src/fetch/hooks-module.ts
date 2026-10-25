import {
  AS_ERROR_SOURCE,
  callerOptionsParameter,
  isRetryableSource,
  MUTATE_OUTCOME_TYPE,
  mutationCallerOptionsSource,
  operationType,
  planForms,
  propertyKey,
  type QueryOperation,
  type QueryPlan,
  REQUIRED_CALL_TYPE,
  retryCheckSource,
} from "@seampact/codegen-core";
import type { ReactQueryOptions } from "../options.js";
import { CLIENT_DIRECTIVE } from "../shared/operation-sources.js";

// The `hooks.ts` of one api for plain fetch (ADR 0021 "Plain fetch"): `create<Api>Hooks` returns the members of
// `create<Api>Queries` plus, per operation, a hook built on React's `useState` and `useEffect` alone. A query hook
// reads on mount and when its request changes, and aborts on unmount and on a request change; it has no cache, so a
// write refreshes nothing and `refetch` reads again. A mutation hook sends one idempotency key per `mutate`, kept
// across the retries its `retry` option asks for.

const QUERY_STATE_TYPES = `/** What a query hook returns: the last data and error of its request, and \`refetch\` to read it again. */
export interface QueryState<Data, Failure> {
readonly data: Data | undefined;
readonly error: Failure | undefined;
readonly isLoading: boolean;
readonly refetch: () => void;
}

/** The caller's query hook options; \`call\` passes the client's call options, its \`signal\` aborting the read too. */
export interface QueryCallerOptions<Operation extends AnyOperationTypes> {
readonly call?: Operation["call"];
}`;

const MUTATION_STATE_TYPES = `${MUTATE_OUTCOME_TYPE}

/**
 * What a mutation hook returns: \`mutate\` sends a request and resolves to its own outcome, never rejecting; the state
 * shows the latest call.
 */
export interface MutationState<Request, Data, Failure> {
readonly mutate: (request: Request) => Promise<MutateOutcome<Data, Failure>>;
readonly isPending: boolean;
readonly error: Failure | undefined;
readonly data: Data | undefined;
}

${mutationCallerOptionsSource("hook")}`;

// The read of one request: started by the effect, its result kept only while that request is still the hook's.
const USE_FETCH_QUERY_SOURCE = `interface QuerySnapshot<Data> {
readonly requestKey: string | null;
readonly data: Data | undefined;
readonly error: Error | undefined;
readonly isLoading: boolean;
}

// Reads on mount, on a request change and on \`refetch\`; the effect's cleanup aborts the read on unmount and on a
// request change. The request is compared by its key, so a new object with the same members reads nothing.
function useFetchQuery<Request, Data>(
request: Request | null,
requestKeyOf: (request: Request) => string,
fetcher: (request: Request, signal: AbortSignal) => Promise<Data>,
): QueryState<Data, Error> {
const latest = useRef({ request, fetcher });
const [refetchCount, setRefetchCount] = useState(0);
const [snapshot, setSnapshot] = useState<QuerySnapshot<Data>>({ requestKey: null, data: undefined, error: undefined, isLoading: false });
const requestKey = request === null ? null : requestKeyOf(request);

useEffect(() => {
latest.current = { request, fetcher };
});

useEffect(() => {
const current = latest.current.request;

if (requestKey === null || current === null) return undefined;

const controller = new AbortController();
const settle = (next: (previous: QuerySnapshot<Data>) => QuerySnapshot<Data>) => {
if (!controller.signal.aborted) setSnapshot(next);
};

setSnapshot((previous) => (previous.requestKey === requestKey ? { ...previous, isLoading: true } : { requestKey, data: undefined, error: undefined, isLoading: true }));
latest.current.fetcher(current, controller.signal).then(
(data) => settle(() => ({ requestKey, data, error: undefined, isLoading: false })),
(rejection: unknown) => settle((previous) => ({ requestKey, data: previous.data, error: asError(rejection), isLoading: false })),
);

return () => controller.abort();
}, [requestKey, refetchCount]);

const refetch = useCallback(() => setRefetchCount((count) => count + 1), []);
// Until the effect starts the read of a new request, the hook shows it loading, without the previous request's data.
const current = snapshot.requestKey === requestKey ? snapshot : { requestKey, data: undefined, error: undefined, isLoading: requestKey !== null };

return { data: current.data, error: current.error, isLoading: current.isLoading, refetch };
}`;

// One fetcher and one attempt object per `mutate`, read once and passed to each retry, so the retries keep one
// idempotency key even when the hooks are built again in render; only the latest `mutate` writes the state, and
// every call resolves to its own outcome.
const USE_FETCH_MUTATION_SOURCE = `interface MutationSnapshot<Data> {
readonly data: Data | undefined;
readonly error: Error | undefined;
readonly isPending: boolean;
}

function useFetchMutation<Request, Data>(
hookName: string,
fetcher: (request: Request, attempt: object) => Promise<Data>,
retry: number,
): MutationState<Request, Data, Error> {
${retryCheckSource("hookName")}

const latestFetcher = useRef(fetcher);
const latestMutate = useRef(0);
const [snapshot, setSnapshot] = useState<MutationSnapshot<Data>>({ data: undefined, error: undefined, isPending: false });

useEffect(() => {
latestFetcher.current = fetcher;
});

const mutate = useCallback(
async (request: Request): Promise<MutateOutcome<Data, Error>> => {
const mutateNumber = latestMutate.current + 1;
const fetcher = latestFetcher.current;
const attempt = {};
const settle = (next: MutationSnapshot<Data>) => {
if (latestMutate.current === mutateNumber) setSnapshot(next);
};

latestMutate.current = mutateNumber;
setSnapshot({ data: undefined, error: undefined, isPending: true });

for (let retriesLeft = retry; ; retriesLeft -= 1) {
try {
const data = await fetcher(request, attempt);

settle({ data, error: undefined, isPending: false });

return { data, error: undefined };
} catch (rejection) {
const error = asError(rejection);

if (retriesLeft <= 0 || !isRetryable(error)) {
settle({ data: undefined, error, isPending: false });

return { data: undefined, error };
}
}
}
},
[retry],
);

return { mutate, isPending: snapshot.isPending, error: snapshot.error, data: snapshot.data };
}`;

const REACT_IMPORT = 'import { useCallback, useEffect, useRef, useState } from "react";';

/** The source of `hooks.ts`; `imports` holds the specifiers of the client, the queries module and the runtime. */
export function hooksModuleSource(
  plan: QueryPlan,
  options: ReactQueryOptions,
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
  const hooks = plan.operations.map((operation) => hookSource(operation, api));

  return [
    ...(options.useClientDirective === "on" ? [CLIENT_DIRECTIVE] : []),
    [
      REACT_IMPORT,
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
    `/** The members of \`create${api}Queries\` and a hook per operation; bind the result to a PascalCase name (\`${api}\`). */
export function create${api}Hooks(client: Client, settings: ${api}QueriesSettings = {}) {
const queries = create${api}Queries(client, settings);

return {
...queries,
${hooks.join("\n\n")}
};
}`,
    `/** What \`create${api}Hooks\` returns. */\nexport type ${api}Hooks = ReturnType<typeof create${api}Hooks>;`,
  ].join("\n\n");
}

function hookSource(operation: QueryOperation, api: string): string {
  const { names } = operation;
  const types = operationType(operation, api);
  // A required options object is read directly, an optional one through `?.`.
  const read = operation.needsTimeout ? "options." : "options?.";

  if (operation.form === "mutation") {
    return `${propertyKey(names.hook)}: (${callerOptionsParameter(operation, `MutationCallerOptions<${types}>`)}): MutationState<${types}["request"], ${types}["data"], ${types}["error"]> =>
useFetchMutation(${JSON.stringify(names.hook)}, (request: ${types}["request"], attempt: object) => queries.${names.options}(${read}call).fetcher(request, attempt), ${read}retry ?? 0),`;
  }

  const filled = JSON.stringify(operation.filledHeaderKeys);

  return `${propertyKey(names.hook)}: (request: ${types}["request"] | null, ${callerOptionsParameter(operation, `QueryCallerOptions<${types}>`)}): QueryState<${types}["data"], ${types}["error"]> =>
useFetchQuery(
request,
(current) => JSON.stringify([keyRequest(current, ${filled})]),
(current, signal) => queries.${names.options}(current, ${read}call).fetcher(signal),
),`;
}
